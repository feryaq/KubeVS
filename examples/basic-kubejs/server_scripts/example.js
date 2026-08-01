ServerEvents.recipes((event) => {
  event.shaped('minecraft:chest', ['PPP', 'P P', 'PPP'], {
    P: '#minecraft:planks',
  });
});
