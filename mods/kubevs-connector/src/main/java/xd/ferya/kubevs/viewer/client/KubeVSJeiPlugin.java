package xd.ferya.kubevs.viewer.client;

import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.pipeline.TextureTarget;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.VertexSorting;
import com.mojang.logging.LogUtils;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import mezz.jei.api.IModPlugin;
import mezz.jei.api.JeiPlugin;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.gui.ingredient.IRecipeSlotView;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.recipe.IFocusGroup;
import mezz.jei.api.recipe.IRecipeManager;
import mezz.jei.api.recipe.RecipeIngredientRole;
import mezz.jei.api.recipe.RecipeType;
import mezz.jei.api.recipe.category.IRecipeCategory;
import mezz.jei.api.runtime.IIngredientManager;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.Rect2i;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.client.ClientHooks;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;
import net.neoforged.neoforge.common.NeoForge;
import org.joml.Matrix4f;
import org.joml.Matrix4fStack;
import org.slf4j.Logger;
import xd.ferya.kubevs.KubeVSConnector;
import xd.ferya.kubevs.viewer.RecipeViewerBridge;
import xd.ferya.kubevs.viewer.RecipeViewerDisplay;
import xd.ferya.kubevs.viewer.RecipeLayoutImage;
import xd.ferya.kubevs.viewer.RecipeViewerSnapshot;
import xd.ferya.kubevs.viewer.RecipeViewerStack;

/**
 * Optional JEI entry point, discovered only when JEI is installed on the physical client.
 */
@JeiPlugin
public final class KubeVSJeiPlugin implements IModPlugin {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final ResourceLocation UID =
            ResourceLocation.fromNamespaceAndPath(KubeVSConnector.MOD_ID, "recipe_viewer_bridge");
    private static final int CAPTURE_BATCH_SIZE = 32;
    private static final int PUBLISH_BATCH_SIZE = 512;
    private static final int IMAGE_CACHE_SIZE = 128;
    private static final Map<String, IRecipeLayoutDrawable<?>> LAYOUTS =
            new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String, CaptureTask> TASKS =
            new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String, RecipeViewerDisplay> DISPLAYS =
            new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String, RecipeLayoutImage> IMAGE_CACHE =
            Collections.synchronizedMap(
                    new LinkedHashMap<>(IMAGE_CACHE_SIZE, 0.75f, true) {
                        @Override
                        protected boolean removeEldestEntry(
                                Map.Entry<String, RecipeLayoutImage> eldest) {
                            return size() > IMAGE_CACHE_SIZE;
                        }
                    });
    private static volatile IJeiRuntime pendingRuntime;
    private static volatile BakeSession bakeSession;

    static {
        NeoForge.EVENT_BUS.addListener(KubeVSJeiPlugin::onClientTick);
        NeoForge.EVENT_BUS.addListener(KubeVSJeiPlugin::registerClientCommands);
    }

    @Override
    public ResourceLocation getPluginUid() {
        return UID;
    }

    @Override
    public void onRuntimeAvailable(IJeiRuntime runtime) {
        RecipeViewerBridge.clear("jei");
        LAYOUTS.clear();
        IMAGE_CACHE.clear();
        TASKS.clear();
        DISPLAYS.clear();
        bakeSession = null;
        pendingRuntime = runtime;
        LOGGER.info("KubeVS queued JEI recipe indexing after JEI startup completes");
    }

    @Override
    public void onRuntimeUnavailable() {
        RecipeViewerBridge.clear("jei");
        pendingRuntime = null;
        TASKS.clear();
        DISPLAYS.clear();
        bakeSession = null;
        LAYOUTS.clear();
        IMAGE_CACHE.clear();
    }

    private static void onClientTick(ClientTickEvent.Post event) {
        IJeiRuntime runtime = pendingRuntime;
        if (runtime != null) {
            pendingRuntime = null;
            try {
                prepareCapture(runtime);
                RecipeViewerBridge.publishLayoutRenderer("jei", KubeVSJeiPlugin::renderLayout);
            } catch (LinkageError | RuntimeException exception) {
                RecipeViewerBridge.clear("jei");
                TASKS.clear();
                bakeSession = null;
                LOGGER.warn("KubeVS could not prepare the optional JEI recipe map", exception);
            }
        }
        BakeSession session = bakeSession;
        if (session == null) {
            return;
        }
        try {
            if (session.processBatch()) {
                bakeSession = null;
            }
        } catch (LinkageError | RuntimeException exception) {
            bakeSession = null;
            LOGGER.warn("KubeVS stopped manual JEI baking after a failure", exception);
            clientMessage("KubeVS: запекание JEI остановлено: " + exception.getMessage(), false);
        }
    }

    private static void registerClientCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher()
                .register(
                        Commands.literal("kvs")
                                .then(
                                        Commands.literal("bake")
                                                .executes(
                                                        context -> {
                                                            startBake();
                                                            return 1;
                                                        })));
    }

    private static void startBake() {
        if (TASKS.isEmpty()) {
            clientMessage("KubeVS: JEI ещё не готов. Повторите /kvs bake через секунду.", false);
            return;
        }
        LAYOUTS.clear();
        DISPLAYS.clear();
        IMAGE_CACHE.clear();
        bakeSession = new BakeSession(new ArrayDeque<>(TASKS.values()));
        clientMessage("KubeVS: начато ручное запекание " + TASKS.size() + " рецептов.", false);
    }

    private static void clientMessage(String message, boolean actionBar) {
        if (Minecraft.getInstance().player != null) {
            Minecraft.getInstance().player.displayClientMessage(Component.literal(message), actionBar);
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static void prepareCapture(IJeiRuntime runtime) {
        IRecipeManager manager = runtime.getRecipeManager();
        IIngredientManager ingredients = runtime.getIngredientManager();
        IFocusGroup noFocus = runtime.getJeiHelpers().getFocusFactory().getEmptyFocusGroup();
        TASKS.clear();
        AtomicInteger syntheticId = new AtomicInteger();
        manager.createRecipeCategoryLookup()
                .get()
                .forEach(
                        wildcardCategory -> {
                            IRecipeCategory category = wildcardCategory;
                            RecipeType recipeType = category.getRecipeType();
                            List<RecipeViewerStack> workstations =
                                    manager.createRecipeCatalystLookup(recipeType)
                                            .get()
                                            .map(typed -> convert(ingredients, typed, 0))
                                            .toList();
                            manager.createRecipeLookup(recipeType)
                                    .get()
                                    .forEach(
                                            recipe -> {
                                                String recipeId =
                                                        java.util.Optional.ofNullable(
                                                                        category.getRegistryName(recipe))
                                                                .map(ResourceLocation::toString)
                                                                .orElseGet(
                                                                        () ->
                                                                                "kubevs:jei/"
                                                                                        + recipeType
                                                                                                .getUid()
                                                                                                .getNamespace()
                                                                                        + "/"
                                                                                        + recipeType
                                                                                                .getUid()
                                                                                                .getPath()
                                                                                        + "/"
                                                                                        + syntheticId
                                                                                                .getAndIncrement());
                                                TASKS.put(
                                                        recipeId,
                                                        new CaptureTask(
                                                                manager,
                                                                ingredients,
                                                                noFocus,
                                                                category,
                                                                recipeType,
                                                                recipe,
                                                                recipeId,
                                                                workstations));
                                            });
                        });
        LOGGER.info("KubeVS mapped {} JEI recipes for on-demand layouts", TASKS.size());
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static boolean captureTask(CaptureTask task, List<RecipeViewerDisplay> displays) {
        try {
            IRecipeLayoutDrawable layout =
                    (IRecipeLayoutDrawable)
                            task.manager()
                                    .createRecipeLayoutDrawable(
                                            task.category(), task.recipe(), task.noFocus())
                                    .orElse(null);
            if (layout == null) {
                return true;
            }
            List<RecipeViewerStack> inputs = new ArrayList<>();
            List<RecipeViewerStack> outputs = new ArrayList<>();
            List<RecipeViewerStack> catalysts = new ArrayList<>();
            List<IRecipeSlotView> slots = layout.getRecipeSlotsView().getSlotViews();
            for (int slot = 0; slot < slots.size(); slot++) {
                IRecipeSlotView view = slots.get(slot);
                List<RecipeViewerStack> target =
                        switch (view.getRole()) {
                            case OUTPUT -> outputs;
                            case CATALYST -> catalysts;
                            case INPUT -> inputs;
                            case RENDER_ONLY -> null;
                        };
                if (target != null) {
                    int slotIndex = slot;
                    view.getAllIngredients()
                            .map(typed -> convert(task.ingredients(), typed, slotIndex))
                            .forEach(target::add);
                }
            }
            displays.add(
                    new RecipeViewerDisplay(
                            task.recipeId(),
                            task.recipeType().getUid().toString(),
                            task.recipeType().getUid().toString(),
                            task.category().getTitle().getString(),
                            "jei",
                            inputs,
                            outputs,
                            catalysts,
                            task.workstations(),
                            null,
                            null,
                            task.category().getWidth(),
                            task.category().getHeight(),
                            null));
            LAYOUTS.put(task.recipeId(), layout);
            return true;
        } catch (IllegalStateException exception) {
            if (exception.getMessage() != null
                    && exception.getMessage().contains("Client Configs have not been created")) {
                return false;
            }
            LOGGER.debug(
                    "Skipping broken JEI display in {}: {}",
                    task.recipeType().getUid(),
                    exception.getMessage());
            return true;
        } catch (RuntimeException exception) {
            LOGGER.debug(
                    "Skipping broken JEI display in {}: {}",
                    task.recipeType().getUid(),
                    exception.getMessage());
            return true;
        }
    }

    @SuppressWarnings("rawtypes")
    private record CaptureTask(
            IRecipeManager manager,
            IIngredientManager ingredients,
            IFocusGroup noFocus,
            IRecipeCategory category,
            RecipeType recipeType,
            Object recipe,
            String recipeId,
            List<RecipeViewerStack> workstations) {}

    private static final class BakeSession {
        private final Deque<CaptureTask> tasks;
        private final List<RecipeViewerDisplay> displays = new ArrayList<>();
        private final int total;
        private int processedSincePublish;
        private int retryDelayTicks = 1;
        private int notReadyAttempts;

        private BakeSession(Deque<CaptureTask> tasks) {
            this.tasks = tasks;
            this.total = tasks.size();
        }

        private boolean processBatch() {
            int processed = 0;
            if (retryDelayTicks > 0) {
                retryDelayTicks--;
                return false;
            }
            while (processed < CAPTURE_BATCH_SIZE && !tasks.isEmpty()) {
                CaptureTask task = tasks.peekFirst();
                if (!captureTask(task, displays)) {
                    notReadyAttempts++;
                    if (notReadyAttempts >= 3) {
                        throw new IllegalStateException(
                                "JEI client configs stayed unavailable after deferred retries");
                    }
                    retryDelayTicks = 20 * notReadyAttempts;
                    return false;
                }
                notReadyAttempts = 0;
                tasks.removeFirst();
                processed++;
                processedSincePublish++;
            }
            if (processedSincePublish >= PUBLISH_BATCH_SIZE || tasks.isEmpty()) {
                displays.forEach(display -> DISPLAYS.put(display.recipeId(), display));
                RecipeViewerBridge.publish(
                        new RecipeViewerSnapshot(
                                "jei", modVersion("jei"), Instant.now(), displays));
                processedSincePublish = 0;
                clientMessage(
                        "KubeVS: JEI " + displays.size() + " / " + total,
                        !tasks.isEmpty());
            }
            if (tasks.isEmpty()) {
                LOGGER.info("KubeVS manually baked {} rich JEI recipe displays", displays.size());
                clientMessage("KubeVS: запекание завершено — " + displays.size() + " рецептов.", false);
                return true;
            }
            return false;
        }
    }

    private static CompletableFuture<RecipeLayoutImage> renderLayout(String recipeId) {
        RecipeLayoutImage cached = IMAGE_CACHE.get(recipeId);
        if (cached != null) {
            return CompletableFuture.completedFuture(cached);
        }
        CompletableFuture<RecipeLayoutImage> future = new CompletableFuture<>();
        Minecraft minecraft = Minecraft.getInstance();
        minecraft.execute(
                () -> {
                    try {
                        IRecipeLayoutDrawable<?> layout = LAYOUTS.get(recipeId);
                        if (layout == null) {
                            CaptureTask task = TASKS.get(recipeId);
                            if (task == null) {
                                throw new IllegalArgumentException(
                                        "Unknown JEI recipe layout: " + recipeId);
                            }
                            List<RecipeViewerDisplay> captured = new ArrayList<>(1);
                            if (!captureTask(task, captured)) {
                                throw new IllegalStateException("JEI client configs are not ready");
                            }
                            captured.forEach(
                                    display -> DISPLAYS.put(display.recipeId(), display));
                            if (bakeSession == null && !captured.isEmpty()) {
                                RecipeViewerBridge.publish(
                                        new RecipeViewerSnapshot(
                                                "jei",
                                                modVersion("jei"),
                                                Instant.now(),
                                                List.copyOf(DISPLAYS.values())));
                            }
                            layout = LAYOUTS.get(recipeId);
                            if (layout == null) {
                                throw new IllegalStateException(
                                        "JEI did not create a layout for " + recipeId);
                            }
                        }
                        RecipeLayoutImage image = captureLayout(recipeId, layout, minecraft);
                        IMAGE_CACHE.put(recipeId, image);
                        future.complete(image);
                    } catch (Throwable exception) {
                        future.completeExceptionally(exception);
                    }
                });
        return future;
    }

    private static RecipeLayoutImage captureLayout(
            String recipeId, IRecipeLayoutDrawable<?> layout, Minecraft minecraft)
            throws IOException {
        final int padding = 6;
        double guiScale = minecraft.getWindow().getGuiScale();
        int targetWidth = minecraft.getWindow().getWidth();
        int targetHeight = minecraft.getWindow().getHeight();
        RenderTarget mainTarget = minecraft.getMainRenderTarget();
        TextureTarget target = new TextureTarget(targetWidth, targetHeight, true, Minecraft.ON_OSX);
        Matrix4fStack modelView = RenderSystem.getModelViewStack();
        RenderSystem.backupProjectionMatrix();
        modelView.pushMatrix();
        try {
            target.setClearColor(0f, 0f, 0f, 0f);
            target.clear(Minecraft.ON_OSX);
            target.bindWrite(true);
            RenderSystem.setProjectionMatrix(
                    new Matrix4f()
                            .setOrtho(
                                    0.0f,
                                    (float) (targetWidth / guiScale),
                                    (float) (targetHeight / guiScale),
                                    0.0f,
                                    1000.0f,
                                    ClientHooks.getGuiFarPlane()),
                    VertexSorting.ORTHOGRAPHIC_Z);
            modelView.translation(0.0f, 0.0f, 10_000.0f - ClientHooks.getGuiFarPlane());
            RenderSystem.applyModelViewMatrix();
            Lighting.setupFor3DItems();
            layout.setPosition(padding, padding);
            GuiGraphics graphics =
                    new GuiGraphics(minecraft, minecraft.renderBuffers().bufferSource());
            layout.tick();
            layout.drawRecipe(graphics, -10_000, -10_000);
            graphics.flush();

            Rect2i rect = layout.getRectWithBorder();
            int pixelX = Math.max(0, (int) Math.floor(rect.getX() * guiScale));
            int pixelY = Math.max(0, (int) Math.floor(rect.getY() * guiScale));
            int pixelWidth =
                    Math.min(targetWidth - pixelX, (int) Math.ceil(rect.getWidth() * guiScale));
            int pixelHeight =
                    Math.min(targetHeight - pixelY, (int) Math.ceil(rect.getHeight() * guiScale));
            if (pixelWidth <= 0 || pixelHeight <= 0) {
                throw new IllegalStateException("JEI returned an empty recipe layout");
            }
            try (NativeImage full =
                            new NativeImage(NativeImage.Format.RGBA, targetWidth, targetHeight, false);
                    NativeImage cropped =
                            new NativeImage(
                                    NativeImage.Format.RGBA, pixelWidth, pixelHeight, false)) {
                full.downloadTexture(0, false);
                full.flipY();
                full.copyRect(
                        cropped,
                        pixelX,
                        pixelY,
                        0,
                        0,
                        pixelWidth,
                        pixelHeight,
                        false,
                        false);
                return new RecipeLayoutImage(
                        recipeId, "jei", pixelWidth, pixelHeight, cropped.asByteArray());
            }
        } finally {
            modelView.popMatrix();
            RenderSystem.applyModelViewMatrix();
            RenderSystem.restoreProjectionMatrix();
            target.destroyBuffers();
            mainTarget.bindWrite(true);
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static RecipeViewerStack convert(
            IIngredientManager manager, ITypedIngredient<?> typed, int slot) {
        Object ingredient = typed.getIngredient();
        IIngredientHelper helper = manager.getIngredientHelper(typed.getType());
        String typeUid = typed.getType().getUid();
        String kind =
                "item_stack".equals(typeUid)
                        ? "item"
                        : typeUid.toLowerCase(java.util.Locale.ROOT).contains("fluid")
                                ? "fluid"
                                : "ingredient";
        long amount = Math.max(0, helper.getAmount(ingredient));
        return new RecipeViewerStack(
                kind,
                helper.getResourceLocation(ingredient).toString(),
                amount,
                1.0,
                helper.getDisplayName(ingredient),
                slot);
    }

    private static String modVersion(String modId) {
        return ModList.get()
                .getModContainerById(modId)
                .map(container -> container.getModInfo().getVersion().toString())
                .orElse("unknown");
    }
}
