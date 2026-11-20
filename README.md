# QIDB - Quick Item Database V4

# Introduction
I made this to fix the **main issue** of Minecraft's Script API: **you can't save ItemStacks in a dynamic property**, and if you try to stringify their properties you still lose some of them that are unreachable with scripts. **This database fixes this problem using structures that save perfect item clones, making it easy, reliable and fast.**

# How does it work?

- This database uses **structures** to save items. It uses an **entity with 256 slots** instead of dropped items, to minimize the lag of the loaded entities.
- One key can hold **a single ItemStack or a list of up to 1024 ItemStacks** (up to 4 storage entities per key). Empty slots in a list keep their position.
- The storage location is saved in the `qidb` scoreboard and kept loaded by a **ticking area**, so no player needs to be near it. It's ready **1 tick** after the database is created.

# Features

- **Keys are unlimited**. They're handled by the QIDB class, where you set the namespace, the **cache** size, the **background saving** speed and the developer debug **logs**.

- The cache keeps the most used keys in **RAM** for instant access. You can **limit the cached key amount** (`cacheSize`) or manage it yourself with `unload()`.

- **Background saving** uses `system.runJob` with a **time budget per tick** (`saveTime`, default **10 ms**), so it never freezes the game. `set()` returns instantly and the key is saved over the next ticks. `flush()` saves right away when you need it.

- **Safe world closing**: `pending` tells you how many keys are still waiting to be saved. If the world closes too early, QIDB writes in the console exactly how many keys were lost.

- **Multiple add-ons, one world**: every add-on using QIDB shares the same storage. They find each other automatically (`QIDB.packs`), and QIDB warns you if two add-ons use the same namespace.

- **Settings can be changed at any time** through `db.settings`, and the defaults of every new database through `QIDB.defaultSettings`.

- Developer debug shows the **logs** in the **console**, like how much **time** a function has taken. Each log type can be turned on or off on its own, or all together with `logs: true / false`.

# What's new in V4

- Background saving with a **time budget per tick** instead of a fixed amount of keys per tick.
- The storage **ticking area** is created with the **Script API** instead of commands.
- **Cross-pack detection** and namespace conflict warnings.
- New API: `unload()`, `flush(key)`, `pending`, `settings`, `QIDB.defaultSettings`, `QIDB.packs`.
- Fixed: storage entities left somewhere else in the world could be mixed into your data. Now only the entities at the storage location are used.
- Fixed: with `cacheSize: 0`, `get()` returned `undefined`.
- **Tested in game**: all **1623 item types** of the game are saved and read back identical, and data survives `/reload` and `/reload all`.

# How to use it

1. Copy `QIDB.js` into your behavior pack's `scripts` folder.
2. Add the storage entity `qidb:storage` to your behavior pack's `entities` folder.

```js
import { QIDB } from "./QIDB.js";

const db = new QIDB("backpacks", { cacheSize: 50, saveTime: 10, logs: false });

// save a whole inventory in ONE key (player: any Player)
const container = player.getComponent("inventory").container;
const items = [];
for (let i = 0; i < container.size; i++) items.push(container.getItem(i));
db.set(player.id, items);

// read it back
if (db.has(player.id)) {
    const saved = db.get(player.id); // ItemStack[]
}
```

| Method | What it does |
| --- | --- |
| `set(key, value)` | Saves an `ItemStack`, an `ItemStack[]` (up to 1024) or `undefined` |
| `get(key)` | Returns the saved value (by reference: use `item.clone()` to edit a copy) |
| `has(key)` | `true` if the key exists |
| `delete(key)` | Deletes a key |
| `keys()` / `values()` | Every key / value of the namespace |
| `clear()` | Deletes every key of the namespace |
| `unload(key?)` | Removes keys from RAM, the saved data stays |
| `flush(key?)` | Saves now, without waiting for the background saving |
| `pending` | Keys not saved yet: the world can be closed safely when it's `0` |

# Performance

Measured in game.
<img width="2400" height="2780" alt="3b6f6b05-36e2-40da-8673-8a62f1f791a5" src="https://github.com/user-attachments/assets/0fdcf359-4061-46df-b571-f8e580077a13" />
<img width="2400" height="2436" alt="f30e1ea1-9b3a-4f2b-b022-d516bc4030b6" src="https://github.com/user-attachments/assets/d355fbbf-11ae-4673-bd69-6e320cd7f087" />
<img width="2400" height="1536" alt="61fafa29-b33e-4244-8813-fcf8f6a28773" src="https://github.com/user-attachments/assets/74f16e72-d642-4561-a5e6-e40bf7a552ab" />

- **Store items together**: 255 ItemStacks in one key are saved in 3 ms; as 255 separate keys they take 302 ms (101× slower).
- **Keep `saveTime` at 10** (default): higher values barely save faster but make the ticks heavier.
- **Avoid `values()` on many keys that are not in RAM**: each one has to be read from its structure.

# License

QIDB V4 is released under the **QIDB License**.
In short: free outside the Marketplace with credits, a written agreement is needed for the Marketplace, no selling, redistributing or cloning it.

# Contributes
Thanks to Drag0nD that helped me a lot in the creation of the database and gave me the structure method sending me his infinite chest add-on.
https://youtu.be/Trljwe6zay8?si=Yf1gC0ZsvOyAXXEP
