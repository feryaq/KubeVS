package xd.ferya.kubevs;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.logging.LogUtils;
import com.mojang.serialization.JsonOps;
import java.net.InetSocketAddress;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.SharedConstants;
import net.minecraft.core.Registry;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.RegistryOps;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.level.block.Block;
import net.neoforged.fml.ModList;
import net.neoforged.neoforgespi.language.IModInfo;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.slf4j.Logger;
import xd.ferya.kubevs.viewer.RecipeViewerProtocol;

final class KubeVSSocketServer extends WebSocketServer {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final int PROTOCOL_VERSION = 1;
    private static final int MAX_PAGE_SIZE = 500;

    private final MinecraftServer minecraftServer;
    private final ConnectorConfig config;
    private volatile String authenticationToken;
    private final Map<WebSocket, RateLimiter> rateLimiters = new ConcurrentHashMap<>();
    private final Map<WebSocket, SessionIdentity> identities = new ConcurrentHashMap<>();
    private final WorkspaceFileService workspaceFiles;
    private final WorkspaceLockManager workspaceLocks = new WorkspaceLockManager();
    private final RecipeViewerProtocol recipeViewers;
    private final Map<String, Optional<String>> iconCache = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Optional<String>> eldest) {
                    return size() > 512;
                }
            });
    private final ArrayDeque<JsonObject> logs = new ArrayDeque<>();

    KubeVSSocketServer(MinecraftServer minecraftServer, ConnectorConfig config) throws IOException {
        super(config.address());
        this.minecraftServer = minecraftServer;
        this.config = config;
        this.authenticationToken = config.token();
        this.workspaceFiles = new WorkspaceFileService(
                minecraftServer
                        .getServerDirectory()
                        .toAbsolutePath()
                        .normalize()
                        .resolve("kubejs"));
        this.recipeViewers = new RecipeViewerProtocol(minecraftServer);
        setConnectionLostTimeout(30);
        setReuseAddr(true);
    }

    @Override
    public void onStart() {
        appendLog("info", "transport", "Connector listening on " + config.publicHost() + ":" + getPort());
        LOGGER.info(
                "KubeVS Connector listening on {}:{} (reload={})",
                config.publicHost(),
                getPort(),
                config.allowReload());
    }

    @Override
    public void onOpen(WebSocket connection, ClientHandshake handshake) {
        if (!config.allowRemote()
                && !connection.getRemoteSocketAddress().getAddress().isLoopbackAddress()) {
            connection.close(1008, "Loopback clients only");
            return;
        }
        Optional<SessionIdentity> identity =
                authenticate(handshake.getFieldValue("Authorization"));
        if (identity.isEmpty()) {
            connection.close(1008, "Authentication failed");
            appendLog("warning", "auth", "Rejected an unauthenticated connection");
            return;
        }

        identities.put(connection, identity.orElseThrow());
        rateLimiters.put(
                connection,
                new RateLimiter(
                        config.requestsPerWindow(),
                        config.rateWindowMillis(),
                        System.currentTimeMillis()));
        connection.send(hello(identity.orElseThrow()).toString());
        appendLog(
                "info",
                "connection",
                "VS Code client connected as " + identity.orElseThrow().displayName());
    }

    @Override
    public void onClose(WebSocket connection, int code, String reason, boolean remote) {
        rateLimiters.remove(connection);
        SessionIdentity identity = identities.remove(connection);
        if (identity != null) {
            workspaceLocks.releaseAll(identity.lockOwner());
        }
        appendLog(
                "info",
                "connection",
                (identity == null ? "Client" : identity.displayName())
                        + " disconnected ("
                        + code
                        + ")");
    }

    @Override
    public void onMessage(WebSocket connection, String message) {
        if (message.length() > config.maxMessageChars()) {
            connection.close(1009, "Message too large");
            return;
        }

        RateLimiter limiter = rateLimiters.get(connection);
        if (limiter == null) {
            connection.close(1008, "Authentication required");
            return;
        }
        if (!limiter.tryAcquire(System.currentTimeMillis())) {
            connection.send(error(null, "RATE_LIMITED", "Too many requests").toString());
            return;
        }

        JsonObject request;
        try {
            request = JsonParser.parseString(message).getAsJsonObject();
        } catch (RuntimeException exception) {
            connection.send(error(null, "INVALID_MESSAGE", "Malformed JSON request").toString());
            return;
        }

        String requestId = string(request, "requestId");
        try {
            if (!"request".equals(string(request, "type")) || string(request, "requestId") == null) {
                connection.send(error(null, "INVALID_MESSAGE", "Expected a request envelope").toString());
                return;
            }
            handleRequest(connection, request);
        } catch (IllegalArgumentException exception) {
            connection.send(error(requestId, "INVALID_MESSAGE", exception.getMessage()).toString());
        } catch (RuntimeException exception) {
            LOGGER.warn("KubeVS Connector request failed: {}", exception.getMessage());
            connection.send(error(requestId, "INTERNAL_ERROR", "Connector request failed").toString());
        }
    }

    @Override
    public void onError(WebSocket connection, Exception exception) {
        if (connection != null) {
            rateLimiters.remove(connection);
            SessionIdentity identity = identities.remove(connection);
            if (identity != null) {
                workspaceLocks.releaseAll(identity.lockOwner());
            }
        }
        LOGGER.warn("KubeVS Connector WebSocket error: {}", exception.getMessage());
        appendLog("warning", "transport", exception.getClass().getSimpleName() + ": " + exception.getMessage());
    }

    void shutdown() {
        try {
            stop(3000);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        appendLog("info", "transport", "Connector stopped");
    }

    void replaceAuthenticationToken(String token) {
        authenticationToken = token;
        for (WebSocket connection : getConnections()) {
            connection.close(1008, "Authentication token rotated");
        }
        appendLog("info", "auth", "Authentication token rotated");
        LOGGER.info("KubeVS Connector authentication token rotated");
    }

    String authenticationToken() {
        return authenticationToken;
    }

    int connectedClientCount() {
        return getConnections().size();
    }

    private void handleRequest(WebSocket connection, JsonObject request) {
        String requestId = string(request, "requestId");
        String method = string(request, "method");
        JsonObject params =
                request.has("params") && request.get("params").isJsonObject()
                        ? request.getAsJsonObject("params")
                        : new JsonObject();

        if (method == null) {
            connection.send(error(requestId, "INVALID_MESSAGE", "Request method is required").toString());
            return;
        }

        switch (method) {
            case "registry.list" -> connection.send(
                    response(requestId, registryList()).toString());
            case "registry.entries" -> connection.send(
                    response(requestId, genericRegistryEntries(params)).toString());
            case "registry.namedEntries" -> connection.send(
                    response(requestId, genericRegistryNamedEntries(params)).toString());
            case "registry.search" -> connection.send(
                    response(requestId, searchRegistries(params)).toString());
            case "registry.icon" -> connection.send(
                    response(requestId, registryIcon(params)).toString());
            case "registry.icons" -> connection.send(
                    response(requestId, registryIcons(params)).toString());
            case "registry.items" -> connection.send(
                    response(requestId, pagedItems(params)).toString());
            case "registry.tags" -> connection.send(
                    response(requestId, genericRegistryTags(params)).toString());
            case "registry.tagValues" -> connection.send(
                    response(requestId, genericTagValues(params)).toString());
            case "recipes.list" -> connection.send(
                    response(requestId, pagedRecipes(params)).toString());
            case "recipes.types" -> connection.send(
                    response(requestId, recipeTypes()).toString());
            case "recipes.get" -> connection.send(
                    response(requestId, recipeJson(params)).toString());
            case "recipes.snapshot" -> connection.send(
                    response(requestId, recipeSnapshot(params)).toString());
            case "recipeViewers.status" -> connection.send(
                    response(requestId, recipeViewers.status()).toString());
            case "recipeViewers.categories" -> connection.send(
                    response(requestId, recipeViewers.categories(params)).toString());
            case "recipeViewers.displays" -> connection.send(
                    response(requestId, recipeViewers.displays(params)).toString());
            case "recipeViewers.display.get" -> connection.send(
                    response(requestId, recipeViewers.display(params)).toString());
            case "recipeViewers.render" -> connection.send(
                    response(requestId, recipeViewers.render(params)).toString());
            case "recipeViewers.workstations" -> connection.send(
                    response(requestId, recipeViewers.workstations(params)).toString());
            case "recipeViewers.usages" -> connection.send(
                    response(requestId, recipeViewers.usages(params)).toString());
            case "recipeViewers.recipesFor" -> connection.send(
                    response(requestId, recipeViewers.recipesFor(params)).toString());
            case "mods.list" -> connection.send(response(requestId, mods()).toString());
            case "logs.list" -> logsList(connection, requestId);
            case "workspace.files.list" -> workspaceFilesList(connection, requestId);
            case "workspace.files.read" -> workspaceFileRead(connection, requestId, params);
            case "workspace.files.write" -> workspaceFileWrite(connection, requestId, params);
            case "workspace.locks.acquire" -> workspaceLockAcquire(connection, requestId, params);
            case "workspace.locks.release" -> workspaceLockRelease(connection, requestId, params);
            case "workspace.locks.status" -> workspaceLockStatus(connection, requestId, params);
            case "workspace.locks.list" -> workspaceLocksList(connection, requestId);
            case "reload.server" -> reloadAuthorized(connection, requestId);
            default -> connection.send(
                    error(requestId, "INVALID_MESSAGE", "Unsupported method: " + method).toString());
        }
    }

    private JsonObject hello(SessionIdentity identity) {
        JsonObject hello = new JsonObject();
        hello.addProperty("type", "hello");
        hello.addProperty("protocolVersion", PROTOCOL_VERSION);
        hello.addProperty("connectorVersion", modVersion("kubevs"));
        hello.addProperty("minecraftVersion", SharedConstants.getCurrentVersion().getName());
        hello.addProperty("kubejsVersion", optionalModVersion("kubejs"));
        JsonObject session = new JsonObject();
        session.addProperty("sessionId", identity.sessionId().toString());
        session.addProperty("kind", identity.admin() ? "admin" : "player");
        session.addProperty("displayName", identity.displayName());
        session.addProperty("permissionLevel", identity.permissionLevel());
        if (identity.playerId() != null) {
            session.addProperty("playerId", identity.playerId().toString());
        }
        hello.add("session", session);
        Path instancePath = minecraftServer.getServerDirectory().toAbsolutePath().normalize();
        JsonObject workspace = new JsonObject();
        workspace.addProperty("instancePath", instancePath.toString());
        workspace.addProperty("kubejsPath", instancePath.resolve("kubejs").toString());
        hello.add("workspace", workspace);

        JsonObject capabilities = new JsonObject();
        capabilities.addProperty("registries", true);
        capabilities.addProperty("recipes", true);
        capabilities.addProperty(
                "logs",
                ConnectorPermissions.allows(
                        identity.permissionLevel(), ConnectorPermissions.READ_LOGS));
        capabilities.addProperty(
                "reload",
                config.allowReload()
                        && ConnectorPermissions.allows(
                                identity.permissionLevel(),
                                ConnectorPermissions.RELOAD_SERVER));
        capabilities.addProperty("inspect", false);
        capabilities.addProperty(
                "workspaceFiles",
                ConnectorPermissions.allows(
                        identity.permissionLevel(), ConnectorPermissions.READ_WORKSPACE));
        capabilities.addProperty(
                "workspaceLocks",
                ConnectorPermissions.allows(
                        identity.permissionLevel(), ConnectorPermissions.EDIT_WORKSPACE));
        capabilities.addProperty("workspaceMaxFileBytes", WorkspaceFileService.DEFAULT_MAX_FILE_BYTES);
        recipeViewers
                .capabilities()
                .entrySet()
                .forEach(entry -> capabilities.add(entry.getKey(), entry.getValue()));
        JsonArray integrations = new JsonArray();
        for (String modId : List.of("create", "oritech", "farmersdelight", "lootjs")) {
            if (ModList.get().isLoaded(modId)) {
                integrations.add(modId);
            }
        }
        capabilities.add("integrations", integrations);
        hello.add("capabilities", capabilities);
        return hello;
    }

    private void workspaceFilesList(WebSocket connection, String requestId) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.READ_WORKSPACE)) {
            return;
        }
        try {
            JsonArray entries = new JsonArray();
            for (WorkspaceFileService.FileEntry file : workspaceFiles.list()) {
                JsonObject entry = new JsonObject();
                entry.addProperty("path", file.path());
                entry.addProperty("size", file.size());
                entry.addProperty("revision", file.revision());
                entries.add(entry);
            }
            JsonObject result = new JsonObject();
            result.add("entries", entries);
            result.addProperty("total", entries.size());
            connection.send(response(requestId, result).toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceFileRead(WebSocket connection, String requestId, JsonObject params) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.READ_WORKSPACE)) {
            return;
        }
        try {
            WorkspaceFileService.FileContent file =
                    workspaceFiles.read(requiredString(params, "path"));
            JsonObject result = new JsonObject();
            result.addProperty("path", file.path());
            result.addProperty("content", file.content());
            result.addProperty("revision", file.revision());
            connection.send(response(requestId, result).toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceFileWrite(WebSocket connection, String requestId, JsonObject params) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.EDIT_WORKSPACE)) {
            return;
        }
        try {
            String path = requiredString(params, "path");
            String key = workspaceFiles.canonicalKey(path);
            WorkspaceLockManager.Owner owner = identity(connection).lockOwner();
            if (!workspaceLocks.isOwnedBy(key, owner)) {
                connection.send(error(
                                requestId,
                                "LOCK_REQUIRED",
                                "Acquire the file lock before writing")
                        .toString());
                return;
            }
            WorkspaceFileService.FileContent file = workspaceFiles.write(
                    path,
                    requiredText(params, "content"),
                    requiredText(params, "expectedRevision"));
            JsonObject result = new JsonObject();
            result.addProperty("path", file.path());
            result.addProperty("revision", file.revision());
            connection.send(response(requestId, result).toString());
            appendLog(
                    "info",
                    "workspace",
                    identity(connection).displayName() + " wrote " + file.path());
        } catch (WorkspaceFileService.RevisionConflictException conflict) {
            JsonObject error = error(requestId, "REVISION_CONFLICT", conflict.getMessage());
            error.addProperty("actualRevision", conflict.actualRevision());
            connection.send(error.toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceLockAcquire(WebSocket connection, String requestId, JsonObject params) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.EDIT_WORKSPACE)) {
            return;
        }
        try {
            String key = workspaceFiles.canonicalKey(requiredString(params, "path"));
            WorkspaceLockManager.Owner owner = identity(connection).lockOwner();
            WorkspaceLockManager.Lock lock = workspaceLocks.acquire(key, owner);
            JsonObject result = lockJson(lock);
            result.addProperty("acquired", lock.owner().sessionId().equals(owner.sessionId()));
            connection.send(response(requestId, result).toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceLockRelease(WebSocket connection, String requestId, JsonObject params) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.EDIT_WORKSPACE)) {
            return;
        }
        try {
            String key = workspaceFiles.canonicalKey(requiredString(params, "path"));
            boolean released = workspaceLocks.release(key, identity(connection).lockOwner());
            JsonObject result = new JsonObject();
            result.addProperty("path", key);
            result.addProperty("released", released);
            connection.send(response(requestId, result).toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceLockStatus(WebSocket connection, String requestId, JsonObject params) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.EDIT_WORKSPACE)) {
            return;
        }
        try {
            String key = workspaceFiles.canonicalKey(requiredString(params, "path"));
            WorkspaceLockManager.Lock lock = workspaceLocks.status(key);
            JsonObject result = lock == null ? new JsonObject() : lockJson(lock);
            result.addProperty("path", key);
            result.addProperty("locked", lock != null);
            connection.send(response(requestId, result).toString());
        } catch (IOException exception) {
            sendWorkspaceError(connection, requestId, "FILE_ERROR", exception);
        }
    }

    private void workspaceLocksList(WebSocket connection, String requestId) {
        if (!requirePermission(
                connection, requestId, ConnectorPermissions.EDIT_WORKSPACE)) {
            return;
        }
        JsonArray entries = new JsonArray();
        workspaceLocks.list().stream().map(KubeVSSocketServer::lockJson).forEach(entries::add);
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("total", entries.size());
        connection.send(response(requestId, result).toString());
    }

    private SessionIdentity identity(WebSocket connection) {
        SessionIdentity identity = identities.get(connection);
        if (identity == null) {
            throw new IllegalStateException("Authenticated session is missing");
        }
        return identity;
    }

    private boolean requirePermission(
            WebSocket connection, String requestId, int minimumLevel) {
        SessionIdentity identity = identity(connection);
        if (ConnectorPermissions.allows(identity.permissionLevel(), minimumLevel)) {
            return true;
        }
        connection.send(error(
                        requestId,
                        "PERMISSION_DENIED",
                        "This operation requires Minecraft permission level "
                                + minimumLevel)
                .toString());
        return false;
    }

    private void logsList(WebSocket connection, String requestId) {
        if (requirePermission(connection, requestId, ConnectorPermissions.READ_LOGS)) {
            connection.send(response(requestId, logSnapshot()).toString());
        }
    }

    private void reloadAuthorized(WebSocket connection, String requestId) {
        if (requirePermission(connection, requestId, ConnectorPermissions.RELOAD_SERVER)) {
            reload(connection, requestId);
        }
    }

    private static JsonObject lockJson(WorkspaceLockManager.Lock lock) {
        JsonObject result = new JsonObject();
        result.addProperty("path", lock.path());
        result.addProperty("owner", lock.owner().displayName());
        result.addProperty("ownerSessionId", lock.owner().sessionId());
        return result;
    }

    private static void sendWorkspaceError(
            WebSocket connection, String requestId, String code, IOException exception) {
        connection.send(error(requestId, code, exception.getMessage()).toString());
    }

    private JsonObject pagedItems(JsonObject params) {
        List<String> ids =
                BuiltInRegistries.ITEM.keySet().stream()
                        .map(Object::toString)
                        .sorted()
                        .toList();
        return page(ids, params);
    }

    private JsonObject registryList() {
        JsonArray entries = new JsonArray();
        minecraftServer.registryAccess().listRegistries()
                .map(key -> key.location().toString())
                .sorted()
                .forEach(entries::add);
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("total", entries.size());
        return result;
    }

    private JsonObject genericRegistryEntries(JsonObject params) {
        return page(registry(params).keySet().stream().map(Object::toString).sorted().toList(), params);
    }

    private JsonObject genericRegistryNamedEntries(JsonObject params) {
        Registry<Object> registry = registry(params);
        var all =
                registry.entrySet().stream()
                        .sorted(Comparator.comparing(entry -> entry.getKey().location().toString()))
                        .toList();
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, all.size());
        int to = Math.min(from + limit, all.size());
        JsonArray entries = new JsonArray();
        all.subList(from, to)
                .forEach(
                        entry ->
                                entries.add(
                                        namedEntry(entry.getKey().location(), entry.getValue(), null)));
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", all.size());
        result.addProperty("hasMore", to < all.size());
        return result;
    }

    private JsonObject searchRegistries(JsonObject params) {
        String rawQuery = string(params, "query");
        String query = rawQuery == null ? "" : rawQuery.strip().toLowerCase(Locale.ROOT);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        JsonArray entries = new JsonArray();
        int total = 0;

        var registries =
                minecraftServer.registryAccess().registries()
                        .sorted(Comparator.comparing(entry -> entry.key().location().toString()))
                        .toList();
        for (RegistryAccess.RegistryEntry<?> registryEntry : registries) {
            String registryId = registryEntry.key().location().toString();
            var values =
                    registryEntry.value().entrySet().stream()
                            .sorted(
                                    Comparator.comparing(
                                            entry -> entry.getKey().location().toString()))
                            .toList();
            for (var valueEntry : values) {
                ResourceLocation id = valueEntry.getKey().location();
                Object value = valueEntry.getValue();
                String name = displayName(value, id);
                String translationKey = translationKey(value);
                String searchable =
                        (registryId
                                        + " "
                                        + id
                                        + " "
                                        + name
                                        + " "
                                        + (translationKey == null ? "" : translationKey))
                                .toLowerCase(Locale.ROOT);
                if (!query.isEmpty() && !searchable.contains(query)) {
                    continue;
                }
                total++;
                if (entries.size() < limit) {
                    entries.add(namedEntry(id, value, registryId));
                }
            }
            var tags = registryEntry.value().getTagNames().map(TagKey::location).sorted().toList();
            for (ResourceLocation tagId : tags) {
                String name = "Tag: " + displayName(null, tagId);
                String searchable =
                        (registryId + " #" + tagId + " " + name).toLowerCase(Locale.ROOT);
                if (!query.isEmpty() && !searchable.contains(query)) {
                    continue;
                }
                total++;
                if (entries.size() < limit) {
                    JsonObject tag = new JsonObject();
                    tag.addProperty("registry", registryId);
                    tag.addProperty("id", "#" + tagId);
                    tag.addProperty("name", name);
                    tag.add("translationKey", com.google.gson.JsonNull.INSTANCE);
                    entries.add(tag);
                }
            }
        }

        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("total", total);
        result.addProperty("truncated", total > entries.size());
        return result;
    }

    private static JsonObject namedEntry(
            ResourceLocation id, Object value, String registryId) {
        JsonObject named = new JsonObject();
        if (registryId != null) {
            named.addProperty("registry", registryId);
        }
        named.addProperty("id", id.toString());
        named.addProperty("name", displayName(value, id));
        String translationKey = translationKey(value);
        if (translationKey == null) {
            named.add("translationKey", com.google.gson.JsonNull.INSTANCE);
        } else {
            named.addProperty("translationKey", translationKey);
        }
        return named;
    }

    private static String displayName(Object value, ResourceLocation id) {
        if (value instanceof Item item) {
            return item.getDescription().getString();
        }
        if (value instanceof Block block) {
            return block.getName().getString();
        }
        if (value instanceof EntityType<?> entityType) {
            return entityType.getDescription().getString();
        }
        String path = id.getPath().replace('/', ' ').replace('_', ' ');
        StringBuilder result = new StringBuilder(path.length());
        boolean capitalize = true;
        for (int index = 0; index < path.length(); index++) {
            char current = path.charAt(index);
            result.append(capitalize ? Character.toUpperCase(current) : current);
            capitalize = current == ' ';
        }
        return result.toString();
    }

    private static String translationKey(Object value) {
        if (value instanceof Item item) {
            return item.getDescriptionId();
        }
        if (value instanceof Block block) {
            return block.getDescriptionId();
        }
        if (value instanceof EntityType<?> entityType) {
            return entityType.getDescriptionId();
        }
        return null;
    }

    private JsonObject registryIcon(JsonObject params) {
        ResourceLocation id = ResourceLocation.parse(requiredString(params, "id"));
        if (!BuiltInRegistries.ITEM.containsKey(id)) {
            throw new IllegalArgumentException("Unknown item: " + id);
        }
        Optional<String> dataUri =
                iconCache.computeIfAbsent(id.toString(), ignored -> resolveItemIcon(id));
        JsonObject result = new JsonObject();
        result.addProperty("id", id.toString());
        if (dataUri.isPresent()) {
            result.addProperty("dataUri", dataUri.get());
        } else {
            result.add("dataUri", com.google.gson.JsonNull.INSTANCE);
        }
        return result;
    }

    private JsonObject registryIcons(JsonObject params) {
        if (!params.has("ids") || !params.get("ids").isJsonArray()) {
            throw new IllegalArgumentException("Missing parameter: ids");
        }
        JsonArray ids = params.getAsJsonArray("ids");
        if (ids.size() > 128) {
            throw new IllegalArgumentException("At most 128 icons can be requested");
        }
        JsonObject entries = new JsonObject();
        for (JsonElement element : ids) {
            if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
                throw new IllegalArgumentException("Icon IDs must be strings");
            }
            ResourceLocation id = ResourceLocation.parse(element.getAsString());
            if (!BuiltInRegistries.ITEM.containsKey(id)) {
                continue;
            }
            Optional<String> dataUri =
                    iconCache.computeIfAbsent(id.toString(), ignored -> resolveItemIcon(id));
            dataUri.ifPresent(uri -> entries.addProperty(id.toString(), uri));
        }
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        return result;
    }

    private Optional<String> resolveItemIcon(ResourceLocation itemId) {
        Optional<byte[]> direct =
                readAsset(
                        itemId.getNamespace(),
                        "textures/item/" + itemId.getPath() + ".png");
        Optional<byte[]> image =
                direct.isPresent()
                        ? direct
                        : resolveModelTexture(
                                ResourceLocation.fromNamespaceAndPath(
                                        itemId.getNamespace(), "item/" + itemId.getPath()),
                                0);
        return image.map(
                bytes ->
                        "data:image/png;base64,"
                                + Base64.getEncoder().encodeToString(bytes));
    }

    private Optional<byte[]> resolveModelTexture(ResourceLocation modelId, int depth) {
        if (depth > 8) {
            return Optional.empty();
        }
        Optional<byte[]> modelBytes =
                readAsset(
                        modelId.getNamespace(),
                        "models/" + modelId.getPath() + ".json");
        if (modelBytes.isEmpty()) {
            return Optional.empty();
        }
        try {
            JsonObject model =
                    JsonParser.parseString(new String(modelBytes.get(), StandardCharsets.UTF_8))
                            .getAsJsonObject();
            if (model.has("textures") && model.get("textures").isJsonObject()) {
                JsonObject textures = model.getAsJsonObject("textures");
                for (String key : List.of("layer0", "all", "texture", "particle", "side", "top")) {
                    String reference = resolveTextureReference(textures, key);
                    if (reference == null || reference.startsWith("#")) {
                        continue;
                    }
                    ResourceLocation texture = ResourceLocation.parse(reference);
                    Optional<byte[]> image =
                            readAsset(
                                    texture.getNamespace(),
                                    "textures/" + texture.getPath() + ".png");
                    if (image.isPresent()) {
                        return image;
                    }
                }
            }
            if (model.has("parent") && model.get("parent").isJsonPrimitive()) {
                return resolveModelTexture(
                        ResourceLocation.parse(model.get("parent").getAsString()), depth + 1);
            }
        } catch (RuntimeException exception) {
            LOGGER.debug("Unable to resolve item model {}: {}", modelId, exception.getMessage());
        }
        return Optional.empty();
    }

    private static String resolveTextureReference(JsonObject textures, String key) {
        if (!textures.has(key) || !textures.get(key).isJsonPrimitive()) {
            return null;
        }
        String value = textures.get(key).getAsString();
        for (int depth = 0; depth < 8 && value.startsWith("#"); depth++) {
            String alias = value.substring(1);
            if (!textures.has(alias) || !textures.get(alias).isJsonPrimitive()) {
                break;
            }
            value = textures.get(alias).getAsString();
        }
        return value;
    }

    private Optional<byte[]> readAsset(String namespace, String relativePath) {
        String resourcePath = "assets/" + namespace + "/" + relativePath;
        var modFile = ModList.get().getModFileById(namespace);
        if (modFile != null) {
            Path path = modFile.getFile().findResource(resourcePath.split("/"));
            if (Files.isRegularFile(path)) {
                try {
                    byte[] bytes = Files.readAllBytes(path);
                    if (bytes.length <= 1024 * 1024) {
                        return Optional.of(bytes);
                    }
                } catch (IOException exception) {
                    LOGGER.debug("Unable to read {}: {}", resourcePath, exception.getMessage());
                }
            }
        }
        try (InputStream stream =
                KubeVSSocketServer.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (stream == null) {
                return Optional.empty();
            }
            byte[] bytes = stream.readNBytes(1024 * 1024 + 1);
            return bytes.length <= 1024 * 1024 ? Optional.of(bytes) : Optional.empty();
        } catch (IOException exception) {
            LOGGER.debug("Unable to read {}: {}", resourcePath, exception.getMessage());
            return Optional.empty();
        }
    }

    private JsonObject genericRegistryTags(JsonObject params) {
        return page(
                registry(params).getTagNames().map(tag -> tag.location().toString()).sorted().toList(),
                params);
    }

    private JsonObject genericTagValues(JsonObject params) {
        Registry<Object> registry = registry(params);
        String tagId = requiredString(params, "tag");
        TagKey<Object> tag = TagKey.create(registry.key(), ResourceLocation.parse(tagId));
        List<String> values =
                registry.getTag(tag)
                        .stream()
                        .flatMap(named -> named.stream())
                        .map(holder -> registry.getKey(holder.value()).toString())
                        .sorted()
                        .toList();
        return page(values, params);
    }

    private JsonObject pagedRecipes(JsonObject params) {
        List<String> ids =
                minecraftServer.getRecipeManager().getRecipes().stream()
                        .map(holder -> holder.id().toString())
                        .sorted()
                        .toList();
        return page(ids, params);
    }

    private JsonObject recipeTypes() {
        Map<String, List<String>> grouped = new java.util.TreeMap<>();
        for (RecipeHolder<?> holder : minecraftServer.getRecipeManager().getRecipes()) {
            String type = BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString();
            grouped.computeIfAbsent(type, ignored -> new ArrayList<>()).add(holder.id().toString());
        }
        JsonObject types = new JsonObject();
        grouped.forEach(
                (type, ids) -> {
                    ids.sort(String::compareTo);
                    JsonArray values = new JsonArray();
                    ids.forEach(values::add);
                    types.add(type, values);
                });
        JsonObject result = new JsonObject();
        result.add("types", types);
        result.addProperty("total", grouped.values().stream().mapToInt(List::size).sum());
        return result;
    }

    private JsonObject recipeJson(JsonObject params) {
        ResourceLocation id = ResourceLocation.parse(requiredString(params, "id"));
        RecipeHolder<?> holder =
                minecraftServer
                        .getRecipeManager()
                        .byKey(id)
                        .orElseThrow(() -> new IllegalArgumentException("Unknown recipe: " + id));
        RegistryOps<JsonElement> ops =
                RegistryOps.create(JsonOps.INSTANCE, minecraftServer.registryAccess());
        JsonElement encoded =
                Recipe.CODEC
                        .encodeStart(ops, holder.value())
                        .getOrThrow(message -> new IllegalStateException("Recipe encoding failed: " + message));
        JsonObject result = new JsonObject();
        result.addProperty("id", id.toString());
        result.addProperty(
                "recipeType",
                BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString());
        result.add("json", encoded);
        return result;
    }

    private JsonObject recipeSnapshot(JsonObject params) {
        List<RecipeHolder<?>> all =
                minecraftServer.getRecipeManager().getRecipes().stream()
                        .sorted(Comparator.comparing(holder -> holder.id().toString()))
                        .toList();
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, all.size());
        int to = Math.min(from + limit, all.size());
        RegistryOps<JsonElement> ops =
                RegistryOps.create(JsonOps.INSTANCE, minecraftServer.registryAccess());
        JsonArray entries = new JsonArray();
        for (RecipeHolder<?> holder : all.subList(from, to)) {
            JsonElement encoded =
                    Recipe.CODEC
                            .encodeStart(ops, holder.value())
                            .getOrThrow(
                                    message ->
                                            new IllegalStateException(
                                                    "Recipe encoding failed: " + message));
            JsonObject entry = new JsonObject();
            entry.addProperty("id", holder.id().toString());
            entry.addProperty(
                    "recipeType",
                    BuiltInRegistries.RECIPE_TYPE
                            .getKey(holder.value().getType())
                            .toString());
            entry.add("json", encoded);
            entries.add(entry);
        }
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", all.size());
        result.addProperty("hasMore", to < all.size());
        return result;
    }

    private JsonObject mods() {
        JsonArray entries = new JsonArray();
        ModList.get().getMods().stream()
                .sorted(Comparator.comparing(IModInfo::getModId))
                .forEach(
                        info -> {
                            JsonObject mod = new JsonObject();
                            mod.addProperty("id", info.getModId());
                            mod.addProperty("name", info.getDisplayName());
                            mod.addProperty("version", info.getVersion().toString());
                            entries.add(mod);
                        });
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("total", entries.size());
        return result;
    }

    private JsonObject logSnapshot() {
        JsonArray entries = new JsonArray();
        synchronized (logs) {
            logs.forEach(entries::add);
        }
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        return result;
    }

    private void reload(WebSocket connection, String requestId) {
        if (!config.allowReload()) {
            connection.send(
                    error(
                                    requestId,
                                    "PERMISSION_DENIED",
                                    "Server reload is disabled; set permissions.allowReload=true in config/kubevs-connector.toml")
                            .toString());
            return;
        }
        appendLog("info", "reload", "Server resource reload requested");
        minecraftServer.execute(
                () ->
                        minecraftServer
                                .reloadResources(
                                        minecraftServer
                                                .getPackRepository()
                                                .getSelectedPacks()
                                                .stream()
                                                .map(pack -> pack.getId())
                                                .toList())
                                .whenComplete(
                                        (ignored, throwable) -> {
                                            if (throwable == null) {
                                                appendLog("info", "reload", "Server resource reload completed");
                                                JsonObject result = new JsonObject();
                                                result.addProperty("reloaded", true);
                                                connection.send(response(requestId, result).toString());
                                            } else {
                                                appendLog(
                                                        "error",
                                                        "reload",
                                                        "Server resource reload failed: "
                                                                + throwable.getMessage());
                                                connection.send(
                                                        error(
                                                                        requestId,
                                                                        "INTERNAL_ERROR",
                                                                        "Server resource reload failed")
                                                                .toString());
                                            }
                                        }));
    }

    private JsonObject page(List<String> all, JsonObject params) {
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, all.size());
        int to = Math.min(from + limit, all.size());
        JsonArray entries = new JsonArray();
        all.subList(from, to).forEach(entries::add);
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", all.size());
        result.addProperty("hasMore", to < all.size());
        return result;
    }

    private JsonObject pageObjects(List<JsonObject> all, JsonObject params) {
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, all.size());
        int to = Math.min(from + limit, all.size());
        JsonArray entries = new JsonArray();
        all.subList(from, to).forEach(entries::add);
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", all.size());
        result.addProperty("hasMore", to < all.size());
        return result;
    }

    private void appendLog(String level, String category, String message) {
        JsonObject entry = new JsonObject();
        entry.addProperty("timestamp", Instant.now().toString());
        entry.addProperty("level", level);
        entry.addProperty("category", category);
        entry.addProperty("message", message);
        synchronized (logs) {
            while (logs.size() >= 1000) {
                logs.removeFirst();
            }
            logs.addLast(entry);
        }
    }

    private Optional<SessionIdentity> authenticate(String header) {
        if (header == null || !header.startsWith("Bearer ")) {
            return Optional.empty();
        }
        String token = header.substring("Bearer ".length());
        if (MessageDigest.isEqual(
                authenticationToken.getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8))) {
            return Optional.of(new SessionIdentity(
                    UUID.randomUUID(), true, null, "server-admin", 4));
        }
        return config.playerTokens()
                .authenticate(token)
                .map(credential -> new SessionIdentity(
                        UUID.randomUUID(),
                        false,
                        credential.playerId(),
                        credential.playerName(),
                        credential.permissionLevel()));
    }

    private record SessionIdentity(
            UUID sessionId,
            boolean admin,
            UUID playerId,
            String displayName,
            int permissionLevel) {
        WorkspaceLockManager.Owner lockOwner() {
            return new WorkspaceLockManager.Owner(sessionId.toString(), displayName);
        }
    }

    private static JsonObject response(String requestId, JsonObject result) {
        JsonObject response = new JsonObject();
        response.addProperty("type", "response");
        response.addProperty("requestId", requestId);
        response.addProperty("ok", true);
        response.add("result", result);
        return response;
    }

    private static JsonObject error(String requestId, String code, String message) {
        JsonObject error = new JsonObject();
        error.addProperty("type", "error");
        if (requestId != null) {
            error.addProperty("requestId", requestId);
        }
        error.addProperty("code", code);
        error.addProperty("message", message);
        return error;
    }

    private static String string(JsonObject object, String key) {
        return object.has(key) && object.get(key).isJsonPrimitive()
                ? object.get(key).getAsString()
                : null;
    }

    private static int integer(
            JsonObject object, String key, int fallback, int minimum, int maximum) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive()) {
            return fallback;
        }
        int value = object.get(key).getAsInt();
        return Math.max(minimum, Math.min(maximum, value));
    }

    @SuppressWarnings("unchecked")
    private Registry<Object> registry(JsonObject params) {
        ResourceLocation id = ResourceLocation.parse(requiredString(params, "registry"));
        RegistryAccess.RegistryEntry<?> entry =
                minecraftServer
                        .registryAccess()
                        .registries()
                        .filter(candidate -> candidate.key().location().equals(id))
                        .findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("Unknown registry: " + id));
        return (Registry<Object>) entry.value();
    }

    private static String requiredString(JsonObject object, String key) {
        if (!object.has(key)
                || !object.get(key).isJsonPrimitive()
                || !object.getAsJsonPrimitive(key).isString()) {
            throw new IllegalArgumentException("Missing string parameter: " + key);
        }
        String value = object.get(key).getAsString();
        if (value.isBlank()) {
            throw new IllegalArgumentException("Missing parameter: " + key);
        }
        return value;
    }

    private static String requiredText(JsonObject object, String key) {
        if (!object.has(key)
                || !object.get(key).isJsonPrimitive()
                || !object.getAsJsonPrimitive(key).isString()) {
            throw new IllegalArgumentException("Missing string parameter: " + key);
        }
        return object.get(key).getAsString();
    }

    private static String optionalModVersion(String modId) {
        return ModList.get()
                .getModContainerById(modId)
                .map(container -> container.getModInfo().getVersion().toString())
                .orElse(null);
    }

    private static String modVersion(String modId) {
        return optionalModVersion(modId) == null ? "unknown" : optionalModVersion(modId);
    }
}
