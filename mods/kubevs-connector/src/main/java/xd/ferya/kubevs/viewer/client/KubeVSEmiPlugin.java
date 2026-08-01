package xd.ferya.kubevs.viewer.client;

import com.mojang.logging.LogUtils;
import dev.emi.emi.api.EmiApi;
import dev.emi.emi.api.EmiEntrypoint;
import dev.emi.emi.api.EmiPlugin;
import dev.emi.emi.api.EmiRegistry;
import dev.emi.emi.api.recipe.EmiRecipe;
import dev.emi.emi.api.recipe.EmiRecipeCategory;
import dev.emi.emi.api.recipe.EmiRecipeManager;
import dev.emi.emi.api.stack.EmiIngredient;
import dev.emi.emi.api.stack.EmiStack;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.material.Fluid;
import net.neoforged.fml.ModList;
import org.slf4j.Logger;
import xd.ferya.kubevs.viewer.RecipeViewerBridge;
import xd.ferya.kubevs.viewer.RecipeViewerDisplay;
import xd.ferya.kubevs.viewer.RecipeViewerSnapshot;
import xd.ferya.kubevs.viewer.RecipeViewerStack;

/**
 * Optional EMI entry point.
 *
 * <p>EMI alone discovers this class. Nothing in the common Connector references it, so its client
 * and EMI types are never resolved on a dedicated server.
 */
@EmiEntrypoint
public final class KubeVSEmiPlugin implements EmiPlugin {
    private static final Logger LOGGER = LogUtils.getLogger();

    @Override
    public void register(EmiRegistry registry) {
        // EMI calls register while rebuilding its registry. Deferring by one client task observes
        // the completed public recipe manager instead of a partially populated registry.
        Minecraft.getInstance().execute(KubeVSEmiPlugin::captureSnapshot);
    }

    private static void captureSnapshot() {
        try {
            EmiRecipeManager manager = EmiApi.getRecipeManager();
            if (manager == null) {
                return;
            }
            List<RecipeViewerDisplay> displays = new ArrayList<>();
            AtomicInteger syntheticId = new AtomicInteger();
            for (EmiRecipe recipe : manager.getRecipes()) {
                displays.add(convert(manager, recipe, syntheticId.getAndIncrement()));
            }
            RecipeViewerBridge.publish(
                    new RecipeViewerSnapshot(
                            "emi", modVersion("emi"), Instant.now(), displays));
            LOGGER.info("KubeVS captured {} rich EMI recipe displays", displays.size());
        } catch (LinkageError | RuntimeException exception) {
            RecipeViewerBridge.clear("emi");
            LOGGER.warn("KubeVS could not capture the optional EMI recipe index", exception);
        }
    }

    private static RecipeViewerDisplay convert(
            EmiRecipeManager manager, EmiRecipe recipe, int syntheticIndex) {
        EmiRecipeCategory category = recipe.getCategory();
        String categoryId = category.getId().toString();
        ResourceLocation declaredId = recipe.getId();
        String recipeId =
                declaredId == null
                        ? "kubevs:emi/"
                                + category.getId().getNamespace()
                                + "/"
                                + category.getId().getPath()
                                + "/"
                                + syntheticIndex
                        : declaredId.toString();
        List<RecipeViewerStack> inputs = flatten(recipe.getInputs());
        List<RecipeViewerStack> catalysts = flatten(recipe.getCatalysts());
        List<RecipeViewerStack> outputs = flattenStacks(recipe.getOutputs());
        List<RecipeViewerStack> workstations =
                flatten(manager.getWorkstations(category));
        return new RecipeViewerDisplay(
                recipeId,
                categoryId,
                categoryId,
                category.getName().getString(),
                "emi",
                inputs,
                outputs,
                catalysts,
                workstations,
                null,
                null,
                recipe.getDisplayWidth(),
                recipe.getDisplayHeight(),
                null);
    }

    private static List<RecipeViewerStack> flatten(
            List<? extends EmiIngredient> ingredients) {
        List<RecipeViewerStack> result = new ArrayList<>();
        for (int slot = 0; slot < ingredients.size(); slot++) {
            EmiIngredient ingredient = ingredients.get(slot);
            for (EmiStack stack : ingredient.getEmiStacks()) {
                if (!stack.isEmpty()) {
                    result.add(
                            convertStack(
                                    stack,
                                    ingredient.getAmount(),
                                    ingredient.getChance(),
                                    slot));
                }
            }
        }
        return List.copyOf(result);
    }

    private static List<RecipeViewerStack> flattenStacks(List<EmiStack> stacks) {
        List<RecipeViewerStack> result = new ArrayList<>();
        for (int slot = 0; slot < stacks.size(); slot++) {
            EmiStack stack = stacks.get(slot);
            if (!stack.isEmpty()) {
                result.add(convertStack(stack, stack.getAmount(), stack.getChance(), slot));
            }
        }
        return List.copyOf(result);
    }

    private static RecipeViewerStack convertStack(
            EmiStack stack, long amount, float chance, int slot) {
        Object key = stack.getKey();
        String kind =
                key instanceof Fluid
                        ? "fluid"
                        : key instanceof Item ? "item" : "ingredient";
        return new RecipeViewerStack(
                kind,
                stack.getId().toString(),
                Math.max(0, amount),
                Math.max(0, chance),
                stack.getName().getString(),
                slot);
    }

    private static String modVersion(String modId) {
        return ModList.get()
                .getModContainerById(modId)
                .map(container -> container.getModInfo().getVersion().toString())
                .orElse("unknown");
    }
}
