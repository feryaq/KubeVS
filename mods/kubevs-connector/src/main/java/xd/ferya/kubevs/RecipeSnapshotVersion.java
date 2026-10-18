package xd.ferya.kubevs;

import java.util.List;
import java.util.UUID;

/** Tracks immutable recipe holders, so pages cannot silently cross a resource reload. */
final class RecipeSnapshotVersion<T> {
    private List<T> previous = List.of();
    private String revision = UUID.randomUUID().toString();

    String check(List<T> current, String expected) {
        boolean changed = previous.size() != current.size();
        for (int i = 0; !changed && i < current.size(); i++) {
            changed = previous.get(i) != current.get(i);
        }
        if (changed) {
            previous = List.copyOf(current);
            revision = UUID.randomUUID().toString();
        }
        if (expected != null && !expected.equals(revision)) {
            throw new IllegalArgumentException("Каталог рецептов изменился во время загрузки. Повторите запрос после перезагрузки ресурсов.");
        }
        return revision;
    }
}
