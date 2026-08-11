package xd.ferya.kubevs;

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.bus.api.SubscribeEvent;
import org.slf4j.Logger;

/**
 * Dedicated-server-safe entry point for the KubeVS Connector.
 */
@Mod(KubeVSConnector.MOD_ID)
public final class KubeVSConnector {
    public static final String MOD_ID = "kubevs";
    private static final Logger LOGGER = LogUtils.getLogger();
    private KubeVSSocketServer socketServer;
    private ConnectorConfig connectorConfig;

    public KubeVSConnector(IEventBus modEventBus, ModContainer container) {
        DebugContent.register(modEventBus);
        container.registerConfig(
                ModConfig.Type.COMMON, ConnectorConfigSpec.SPEC, ConnectorConfigSpec.FILE_NAME);
        NeoForge.EVENT_BUS.register(this);
        LOGGER.info("KubeVS Connector {} loaded", container.getModInfo().getVersion());
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        if (socketServer != null) {
            return;
        }
        try {
            connectorConfig = ConnectorConfig.load();
            ConnectorConfig.requireDedicatedPort(
                    connectorConfig.address().getPort(), event.getServer().getPort());
            socketServer = new KubeVSSocketServer(event.getServer(), connectorConfig);
            socketServer.start();
            LOGGER.info(
                    "KubeVS authentication is ready. VS Code discovers the token at {}",
                    connectorConfig.tokenFile().toAbsolutePath().normalize());
        } catch (Exception exception) {
            LOGGER.error("Unable to start KubeVS Connector", exception);
        }
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        ConnectorAuthCommands.register(
                event.getDispatcher(), () -> connectorConfig, () -> socketServer);
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        KubeVSSocketServer current = socketServer;
        socketServer = null;
        connectorConfig = null;
        if (current != null) {
            current.shutdown();
        }
    }
}
