package xd.ferya.kubevs;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;

/**
 * Small, deterministic content set used to verify registry snapshots, icons and recipes.
 */
final class DebugContent {
    static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(KubeVSConnector.MOD_ID);
    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(KubeVSConnector.MOD_ID);

    static final DeferredBlock<Block> DEBUG_BLOCK = BLOCKS.registerSimpleBlock(
            "debug_block",
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 6.0F)
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops());

    static final DeferredItem<Item> DEBUG_ITEM = ITEMS.registerSimpleItem(
            "debug_item", new Item.Properties().stacksTo(64).rarity(Rarity.UNCOMMON));

    static final DeferredItem<?> DEBUG_BLOCK_ITEM = ITEMS.registerSimpleBlockItem(DEBUG_BLOCK);

    private DebugContent() {}

    static void register(IEventBus eventBus) {
        BLOCKS.register(eventBus);
        ITEMS.register(eventBus);
        eventBus.addListener(DebugContent::addCreativeTabItems);
    }

    private static void addCreativeTabItems(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
            event.accept(DEBUG_ITEM.get());
            event.accept(DEBUG_BLOCK.get());
        }
    }
}
