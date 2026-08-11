# Серверная рабочая область KubeVS

Protocol v2 монтирует `<server>/kubejs` в VS Code через схему `kubevs-remote://server/`.
Это настоящая writable workspace-папка, а не список отдельных файлов.

## Операции

- `workspace.files.list` и `workspace.files.read`;
- `workspace.files.write`;
- `workspace.directories.create`;
- `workspace.entries.copy`;
- `workspace.entries.rename`;
- `workspace.entries.delete`;
- `workspace.locks.acquire/release/status/list`;
- событие `workspace.changed`.

Чтение и запись используют Base64, поэтому PNG, JSON, JS и другие assets не проходят через
ошибочное UTF-8-преобразование. Максимальный размер одного файла — 4 МиБ, сообщения — 8 МиБ,
индекс — до 10 000 entries.

## Защита данных

- корнем всегда остаётся серверная папка `kubejs`;
- абсолютные пути, `..`, NUL и symlink запрещены;
- запись выполняется через временный файл и atomic replace;
- write/delete/rename сверяют SHA-256 revision;
- операции над деревом отклоняются, если вложенный путь занят другим участником;
- блокировки освобождаются при закрытии документа или WebSocket-сессии;
- сервер отправляет события своим клиентам, а polling раз в 2,5 секунды ловит изменения,
  выполненные через SSH, панель хостинга или другой редактор.

При `REVISION_CONFLICT` серверный файл остаётся без изменений. VS Code сохраняет изменённый
буфер открытым, чтобы пользователь мог сравнить его с актуальной версией.
