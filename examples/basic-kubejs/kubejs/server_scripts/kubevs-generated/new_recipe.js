ServerEvents.recipes(event => {
  event.shaped("minecraft:acacia_wood", [
    " A ",
    " B ",
    " C "
  ], {
    "A": "minecraft:waxed_copper_bulb",
    "B": "minecraft:acacia_button",
    "C": "#c:dusts"
  }).id("kubevs:new_recipe")
})
