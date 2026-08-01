# Интеграция KubeVS Connector с JEI и EMI

## Что реализовано

Connector использует единый формат recipe display и два независимых клиентских адаптера:

- EMI — `dev.emi:emi-neoforge:1.1.22+1.21.1:api`;
- JEI — `mezz.jei:jei-1.21.1-common-api:19.21.2.313` и
  `mezz.jei:jei-1.21.1-neoforge-api:19.21.2.313`.

API подключены через `compileOnly`. Они не вкладываются в JAR Connector и не становятся
runtime-зависимостями. В `neoforge.mods.toml` обе зависимости помечены как `optional` и
`CLIENT`.

Адаптеры не используют внутренние классы просмотрщиков:

- JEI: официальный `IModPlugin`, `IJeiRuntime`, `IRecipeManager` и recipe layout slots;
- EMI: официальный `EmiPlugin`, `EmiApi`, `EmiRecipeManager` и `EmiRecipe`.

Источники настройки зависимостей:

- JEI, официальный репозиторий и пример зависимостей:
  <https://github.com/mezz/JustEnoughItems>
- JEI Maven: <https://maven.blamejared.com/mezz/jei/>
- EMI, официальный раздел Developers:
  <https://github.com/emilyploszaj/emi>
- EMI Maven: <https://maven.terraformersmc.com/releases/dev/emi/>

## Безопасность dedicated server

Общий код WebSocket-сервера не импортирует JEI, EMI или классы `net.minecraft.client`.
Клиентские классы находятся в отдельном пакете `viewer.client`, не вызываются Connector-ом и
обнаруживаются только самим установленным просмотрщиком.

Если JEI/EMI отсутствуют или клиентский snapshot ещё не готов, протокол автоматически использует
серверный `RecipeManager`. Поэтому тот же JAR можно ставить на dedicated server без JEI и EMI.

## Выбор источника

При готовности обоих snapshots приоритет имеет EMI: его публичная модель напрямую хранит входы,
выходы, catalysts, workstations и признак поддержки recipe tree. Затем используется JEI, затем
обычный `RecipeManager`.

Snapshot неизменяемый и публикуется атомарно. WebSocket-поток никогда не обращается напрямую к
клиентскому GUI или renderer API. Это устраняет гонки между Minecraft client thread и сервером.

## Ограничения первого этапа

- На dedicated server клиентский JEI/EMI работает в другом процессе, поэтому богатый snapshot
  пока не пересылается от игрока на сервер. Connector корректно использует `RecipeManager`.
- `duration` и `energy` остаются пустыми, если просмотрщик не публикует их через общий API.
- Готовый GUI JEI/EMI не снимается как скриншот. KubeVS получает структурированные слоты и
  собственные иконки registry, что быстрее, безопаснее и лучше масштабируется.
- Для synthetic EMI/JEI displays без registry ID создаётся стабильный в пределах snapshot ID в
  namespace `kubevs`.

Следующий этап для remote dedicated server — ограниченный и авторизованный client payload:
клиент Connector формирует snapshot, сжимает его, делит на ограниченные части и передаёт серверу
с привязкой к версии модпака. Сервер должен принимать такие данные только от пользователя с
разрешением и не считать их источником игровых рецептов — лишь визуальным дополнением.
