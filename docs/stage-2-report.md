# Отчёт по этапу 2

## Сделано

- WebSocket-транспорт между VS Code и NeoForge.
- Bearer-аутентификация, localhost-only по умолчанию, ограничение размера сообщений и rate limit.
- Согласование версии протокола и обнаружение возможностей Connector.
- Реальные снимки registries, tags, recipes, mods и ограниченный журнал Connector.
- Универсальные запросы registry entries/tag values и получение JSON существующего рецепта.
- SecretStorage-профили и живые состояния Connection, Registries и Recipes в интерфейсе.
- Save and Reload с сохранением, валидацией, предупреждением для startup scripts, проверкой права,
  прогрессом и журналом.
- Java-WebSocket встроен в production JAR мода через NeoForge Jar-in-Jar.

## Проверено

- Компиляция Java и упаковка Jar-in-Jar.
- JUnit-тесты rate limit и сохранения токена.
- Node-тест WebSocket-клиента с реальным локальным сервером, auth header, hello и request.
- Реальный NeoForge dedicated server 1.21.1 запущен после принятия EULA.
- VS Code-клиент подключился к настоящему Connector, получил registries, items, tags, tag values,
  recipe types, recipe JSON, список модов и журнал, затем успешно выполнил server reload.

## Известные ограничения

- Метаданные registries пока ограничены идентификаторами; изображения и расширенные свойства не
  передаются.
- Журнал содержит события Connector, а не весь Log4j-поток сервера.
- Inspect Held Item пока не реализован.
- Встроенного TLS для удалённого подключения нет.
- KubeJS, LootJS, Create, Oritech и Farmer's Delight не установлены в тестовом окружении.

## Следующий этап

Импорт и безопасная генерация моделей рецептов, после чего визуальные редакторы, Registry Browser,
Craft Graph и калькулятор ресурсов.
