// About the project
/**
 * QIDB - Quick Item Database V4
 * Made by MineCart7           https://github.com/MineCart7/QUICK-ITEM-DATABASE
 * Contact me on Discord:      https://discordapp.com/users/985593016867778590
 * Discord Discussion:         https://discord.com/channels/523663022053392405/1252014916496527380
 */

import { world, system, ItemStack, EntityComponentTypes, StructureSaveMode } from '@minecraft/server';

/**
 * Value that can be saved in a key.
 * @typedef {ItemStack | ItemStack[] | undefined} QIDBValue
 */

/**
 * Developer debug logs shown in the console (`true` = shown).
 * @typedef {Object} QIDBLogs
 * @property {boolean} startUp Database initialized.
 * @property {boolean} save    Background saving: start, progress and end.
 * @property {boolean} load    Storage entities loaded from a structure.
 * @property {boolean} set     `set()` calls.
 * @property {boolean} get     `get()` calls.
 * @property {boolean} has     `has()` calls.
 * @property {boolean} delete  `delete()` calls.
 * @property {boolean} flush   `flush()` calls.
 * @property {boolean} clear   `clear()` calls.
 * @property {boolean} values  `values()` calls.
 * @property {boolean} keys    `keys()` calls.
 * @property {boolean} packs   QIDB found in other packs. Global: only `QIDB.defaultSettings.logs.packs` is read.
 */

/**
 * A pack using QIDB in this world.
 * @typedef {Object} QIDBPackInfo
 * @property {string}   id         Random id of the pack, changes every session.
 * @property {boolean}  local      `true` if it's this pack.
 * @property {string[]} namespaces Namespaces used by the pack.
 */

/**
 * Complete settings of a database, editable at any time through `db.settings`.
 * @typedef {Object} QIDBSettings
 * @property {number}   cacheSize Max amount of keys kept in RAM for quick access, the oldest are dropped first. Use `Infinity` to manage the RAM only with `unload()`.
 * @property {number}   saveTime  Max milliseconds per tick the background saving can use. Higher = faster saving but heavier ticks.
 * @property {QIDBLogs} logs      Developer debug logs.
 */

/**
 * Settings accepted by the constructor: every field is optional and falls back to `QIDB.defaultSettings`.
 * `logs` can also be a single boolean to turn every log on or off.
 * @typedef {Object} QIDBOptions
 * @property {number} [cacheSize]
 * @property {number} [saveTime]
 * @property {boolean | Partial<QIDBLogs>} [logs]
 */

const STORAGE_ENTITY = "qidb:storage";
const STORAGE_Y = 318;
const STORAGE_RADIUS = 1;
const SLOTS = 256;
const MAX_ITEMS = SLOTS * 4;
const MAX_KEY_LENGTH = 30;
const PROGRESS_TICKS = 100;
const INDEX_PROP = "qidb:i";
const ARRAY_PROP = "qidb:a";
const TICKING_AREA_ID = "qidb_storage";

let storageArea;

function date() {
    const now = new Date();
    const ms = now.getMilliseconds().toString().padStart(3, "0");
    return now.toLocaleString().replace(/ (AM|PM)/, `.${ms} $1`);
}

const isValidName = (name) => /^[A-Za-z0-9_-]*$/.test(name);

function isValidValue(value) {
    if (!Array.isArray(value)) return value == null || value instanceof ItemStack;
    for (let i = 0; i < value.length; i++) if (value[i] != null && !(value[i] instanceof ItemStack)) return false;
    return true;
}

const invCount = (value) => Array.isArray(value) ? Math.max(1, Math.ceil(value.length / SLOTS)) : 1;

const inventoryOf = (entity) => entity.getComponent(EntityComponentTypes.Inventory).container;

const log = (message, color = "§a") => console.log(`${color}QIDB > ${message} §r${date()}`);

const qidbError = (message) => new Error(`§cQIDB > ${message} §r${date()}`);

function loadStorageArea(dimension, location) {
    const manager = world.tickingAreaManager;
    storageArea ??= manager.hasTickingArea(TICKING_AREA_ID)
        ? Promise.resolve()
        : manager.createTickingArea(TICKING_AREA_ID, { dimension, from: location, to: location });
    return storageArea;
}

function toKey(namespace, key) {
    if (!isValidName(key)) throw qidbError(`Invalid name: <${key}>. accepted char: A-Z a-z 0-9 _ -`);
    const fullKey = `${namespace}:${key}`;
    if (fullKey.length > MAX_KEY_LENGTH) throw qidbError(`Out of range: <${fullKey}> has more than ${MAX_KEY_LENGTH} characters`);
    return fullKey;
}

const ANNOUNCE_EVENT = "qidb:announce";
const PACK_ID = Math.random().toString(36).slice(2, 10);
const localNamespaces = new Set();
const otherPacks = new Map();
const conflicts = new Set();
let announceScheduled = false;

function announce(ask) {
    system.sendScriptEvent(ANNOUNCE_EVENT, JSON.stringify({ pack: PACK_ID, namespaces: [...localNamespaces], ask }));
}

function scheduleAnnounce() {
    if (announceScheduled) return;
    announceScheduled = true;
    system.run(() => { announceScheduled = false; announce(true); });
}

function checkConflicts(pack, namespaces) {
    for (const namespace of namespaces) {
        if (!localNamespaces.has(namespace) || conflicts.has(`${pack}:${namespace}`)) continue;
        conflicts.add(`${pack}:${namespace}`);
        console.error(`§cQIDB > Namespace conflict: <${namespace}> is used by another pack too, their keys will overwrite each other. §r${date()}`);
    }
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== ANNOUNCE_EVENT) return;
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const { pack, namespaces, ask } = data;
    if (pack === PACK_ID || !Array.isArray(namespaces)) return;

    if (String(otherPacks.get(pack)) !== String(namespaces)) {
        otherPacks.set(pack, namespaces);
        QIDB.defaultSettings.logs.packs && log(`Found QIDB in another pack (${pack}), namespaces: ${namespaces.join(", ") || "-"}`, "§b");
    }
    checkConflicts(pack, namespaces);
    if (ask) announce(false);
}, { namespaces: ["qidb"] });

/**
 * Quick Item Database.
 *
 * `T` is the type of the values, declare it to skip type checks on `get()`:
 * ```js
 * // @type {QIDB<ItemStack>}
 * const swords = new QIDB("swords");
 * swords.get("excalibur").amount;
 * ```
 * @template {QIDBValue} [T=QIDBValue]
 */
export class QIDB {
    /**
     * Defaults used for every setting not passed to the constructor.
     * Edit it before creating a database to change the defaults of all of them.
     * @type {QIDBSettings}
     */
    static defaultSettings = {
        cacheSize: 50,
        saveTime: 10,
        logs: {
            startUp: true,
            save: true,
            load: true,
            set: true,
            get: true,
            has: true,
            delete: true,
            flush: true,
            clear: true,
            values: true,
            keys: true,
            packs: true,
        },
    };

    /**
     * Current settings, can be edited at any time. e.g. `db.settings.logs.get = false`
     * @type {QIDBSettings}
     */
    settings;

    #namespace;
    #dimension;
    #storage;
    #quickAccess = new Map();
    #queue = new Map();
    #saveRun;

    /**
     * Every pack using QIDB in this world with its namespaces, this pack included (`local: true`). Updated live.
     * @type {QIDBPackInfo[]}
     */
    static get packs() {
        const packs = [{ id: PACK_ID, local: true, namespaces: [...localNamespaces] }];
        otherPacks.forEach((namespaces, id) => packs.push({ id, local: false, namespaces }));
        return packs;
    }

    /**
     * @param {string} namespace The unique namespace for the database keys. accepted char: A-Z a-z 0-9 _ -
     * @param {QIDBOptions} [settings] Optional settings, see `QIDBSettings`.
     */
    constructor(namespace = "", settings = {}) {
        if (!isValidName(namespace)) throw qidbError(`<${namespace}> isn't a valid namespace. accepted char: A-Z a-z 0-9 _ -`);
        if (localNamespaces.has(namespace)) throw qidbError(`<${namespace}> is already used by another QIDB of this pack.`);
        this.#namespace = namespace;

        localNamespaces.add(namespace);
        otherPacks.forEach((namespaces, pack) => checkConflicts(pack, namespaces));
        scheduleAnnounce();

        const defaults = QIDB.defaultSettings;
        const logs = typeof settings.logs === "boolean"
            ? Object.fromEntries(Object.keys(defaults.logs).map(name => [name, settings.logs]))
            : { ...defaults.logs, ...settings.logs };
        this.settings = { ...defaults, ...settings, logs };

        system.beforeEvents.shutdown.subscribe(() => {
            if (!this.#queue.size) return;
            console.error(
                `\n\n\n\n§c§lQIDB > Fatal Error >§r§c World closed too early, items not saved correctly.\n\n` +
                `Namespace: ${this.#namespace}\n` +
                `Lost Keys amount: ${this.#queue.size} §r${date()}\n\n\n\n`
            );
        });

        system.run(() => {
            this.#dimension = world.getDimension("overworld");

            const setup = (player) => {
                const objective = world.scoreboard.getObjective("qidb") ?? world.scoreboard.addObjective("qidb");
                if (!objective.hasParticipant("x")) {
                    if (!player) return false;
                    objective.setScore("x", Math.floor(player.location.x));
                    objective.setScore("z", Math.floor(player.location.z));
                }
                const location = { x: objective.getScore("x"), y: STORAGE_Y, z: objective.getScore("z") };
                loadStorageArea(this.#dimension, location)
                    .then(() => {
                        this.#storage = location;
                        this.settings.logs.startUp && log(`is initialized successfully.§r namespace: ${this.#namespace}`, "§q");
                    })
                    .catch(error => console.error(`§cQIDB > Can't load the storage ticking area: ${error} §r${date()}`));
                return true;
            };

            if (setup(world.getPlayers()[0])) return;
            const onSpawn = world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
                if (initialSpawn && setup(player)) world.afterEvents.playerSpawn.unsubscribe(onSpawn);
            });
        });
    }

    #load(key, length) {
        const reading = length === undefined;
        if (reading) world.structureManager.place(key, this.#dimension, this.#storage, { includeEntities: true });
        const entities = this.#dimension.getEntities({ location: this.#storage, maxDistance: STORAGE_RADIUS, type: STORAGE_ENTITY });
        if (reading) entities.sort((a, b) => (a.getDynamicProperty(INDEX_PROP) ?? 0) - (b.getDynamicProperty(INDEX_PROP) ?? 0));
        else {
            while (entities.length < length) entities.push(this.#dimension.spawnEntity(STORAGE_ENTITY, this.#storage));
            while (entities.length > length) entities.pop().remove();
        }
        this.settings.logs.load && log(`Loaded ${entities.length} entities <${key}>`);
        return entities;
    }

    #save(key, entities) {
        try {
            world.structureManager.delete(key);
            world.structureManager.createFromWorld(key, this.#dimension, this.#storage, this.#storage, { saveMode: StructureSaveMode.World, includeEntities: true });
        } finally {
            entities.forEach(entity => entity.remove());
        }
    }

    #romSave(key, value) {
        const isArray = Array.isArray(value);
        const entities = this.#load(key, invCount(value));
        try {
            for (let e = 0; e < entities.length; e++) {
                const entity = entities[e];
                entity.setDynamicProperty(INDEX_PROP, e);
                entity.setDynamicProperty(ARRAY_PROP, isArray);
                const inv = inventoryOf(entity);
                inv.clearAll();
                if (!isArray) {
                    if (value) inv.setItem(0, value);
                    continue;
                }
                const offset = e * SLOTS;
                const end = Math.min(value.length, offset + SLOTS);
                for (let i = offset; i < end; i++) if (value[i]) inv.setItem(i - offset, value[i]);
            }
        } catch (error) {
            entities.forEach(entity => entity.remove());
            throw error;
        }
        this.#save(key, entities);
    }

    #queueSaving(key, value) {
        this.#queue.delete(key);
        this.#queue.set(key, value);
        this.#saveHandler();
    }

    #cache(key, value) {
        this.#quickAccess.delete(key);
        this.#quickAccess.set(key, value);
        while (this.#quickAccess.size > this.settings.cacheSize) this.#quickAccess.delete(this.#quickAccess.keys().next().value);
    }

    #saveHandler() {
        if (this.#saveRun !== undefined) return;

        const self = this;
        const start = Date.now();
        let saved = 0, lastSaved = 0, ticks = 0;
        let jobId;

        function* saveBatch() {
            try {
                const end = Date.now() + self.settings.saveTime;
                for (const key of self.#queue.keys()) {
                    if (Date.now() >= end) break;
                    const value = self.#queue.get(key);
                    self.#queue.delete(key);
                    try { self.#romSave(key, value); saved++; }
                    catch (error) { console.error(`§cQIDB > Failed to save <${key}>: ${error} §r${date()}`); }
                    yield;
                }
            } finally {
                jobId = undefined;
            }
        }

        this.settings.logs.save && log(`Saving ${this.#queue.size} keys, don't close the world.`, "§e");

        this.#saveRun = system.runInterval(() => {
            ticks++;
            if (!this.#queue.size && jobId === undefined) {
                system.clearRun(this.#saveRun);
                this.#saveRun = undefined;
                this.settings.logs.save && log(`Saved ${saved} keys in ${Date.now() - start}ms, you can now close the world safely.`);
                return;
            }
            if (ticks % PROGRESS_TICKS === 0) {
                const speed = ((saved - lastSaved) / (PROGRESS_TICKS / 20)).toFixed(0);
                this.settings.logs.save && log(`Saving, don't close the world.\n§r[Stats]-§eRemaining: ${this.#queue.size} keys | speed: ${speed} keys/s`, "§e");
                lastSaved = saved;
            }
            if (this.#storage && jobId === undefined && this.#queue.size) jobId = system.runJob(saveBatch());
        }, 1);
    }

    /** Amount of keys not saved yet. The world can be closed safely when it's `0`. */
    get pending() {
        return this.#queue.size;
    }

    /**
     * Sets a value as a key in the item database. It's saved in background, see `flush()` to save it now.
     * @param {string} key The unique identifier of the value.
     * @param {T} value The `ItemStack[]` or `ItemStack` value to set.
     * @throws Throws if `value` isn't a valid value or is an array that has more than 1024 items.
     */
    set(key, value) {
        const time = Date.now();
        key = toKey(this.#namespace, key);
        if (!isValidValue(value)) throw qidbError(`Invalid value type. supported: ItemStack | ItemStack[] | undefined`);
        if (Array.isArray(value) && value.length > MAX_ITEMS) throw qidbError(`Out of range: <${key}> has more than ${MAX_ITEMS} ItemStacks`);

        value ??= undefined;
        this.#cache(key, value);
        this.#queueSaving(key, value);
        this.settings.logs.set && log(`Set key <${key}> successfully. ${Date.now() - time}ms`);
    }

    /**
     * Gets the value of a key from the item database.
     * The value is returned by reference: edit a copy (`item.clone()`) if you don't want to change the database,
     * or call `set()` again with the same value to save your edits.
     * @param {string} key The identifier of the value.
     * @returns {T} The `ItemStack` | `ItemStack[]` saved as `key`
     * @throws Throws if the key doesn't exist.
     */
    get(key) {
        const time = Date.now();
        key = toKey(this.#namespace, key);

        let value;
        if (this.#quickAccess.has(key)) value = this.#quickAccess.get(key);
        else {
            if (this.#queue.has(key)) value = this.#queue.get(key);
            else {
                if (!world.structureManager.get(key)) throw qidbError(`The key <${key}> doesn't exist.`);
                if (!this.#storage) throw qidbError(`Storage not initialized yet, wait for a player to join.`);
                const entities = this.#load(key);
                try {
                    const isArray = entities[0]?.getDynamicProperty(ARRAY_PROP) ?? !!world.getDynamicProperty(key);
                    if (!isArray) value = entities[0] && inventoryOf(entities[0]).getItem(0);
                    else {
                        const items = new Array(entities.length * SLOTS);
                        let length = 0;
                        for (let e = 0; e < entities.length; e++) {
                            const inv = inventoryOf(entities[e]);
                            const offset = e * SLOTS;
                            for (let slot = 0; slot < SLOTS; slot++) {
                                const item = inv.getItem(slot);
                                items[offset + slot] = item;
                                if (item) length = offset + slot + 1;
                            }
                        }
                        items.length = length;
                        value = items;
                    }
                } finally {
                    entities.forEach(entity => entity.remove());
                }
            }
            this.#cache(key, value);
        }

        this.settings.logs.get && log(`Got key <${key}> successfully. ${Date.now() - time}ms`);
        return value;
    }

    /**
     * Checks if a key exists in the item database.
     * @param {string} key The identifier of the value.
     * @returns {boolean} `true` if the key exists, `false` if the key doesn't exist.
     */
    has(key) {
        const time = Date.now();
        key = toKey(this.#namespace, key);
        const exist = this.#quickAccess.has(key) || this.#queue.has(key) || !!world.structureManager.get(key);
        this.settings.logs.has && log(`${exist ? "Found" : "Didn't find"} key <${key}>. ${Date.now() - time}ms`);
        return exist;
    }

    /**
     * Deletes a key from the item database.
     * @param {string} key The identifier of the value.
     * @throws Throws if the key doesn't exist.
     */
    delete(key) {
        const time = Date.now();
        key = toKey(this.#namespace, key);
        this.#quickAccess.delete(key);
        const wasQueued = this.#queue.delete(key);
        if (!world.structureManager.delete(key) && !wasQueued) throw qidbError(`The key <${key}> doesn't exist.`);
        world.setDynamicProperty(key, undefined);
        this.settings.logs.delete && log(`Deleted key <${key}> successfully. ${Date.now() - time}ms`);
    }

    /**
     * Removes keys from RAM (quick access) without touching the saved data.
     * Unsaved keys are still saved normally.
     * @param {string} [key] The key to unload, if omitted unloads every key.
     */
    unload(key) {
        if (key === undefined) this.#quickAccess.clear();
        else this.#quickAccess.delete(toKey(this.#namespace, key));
    }

    /**
     * Saves now, without waiting for the background saving.
     * @param {string} [key] The key to save, if omitted saves every pending key.
     * @throws Throws if the storage isn't initialized yet (no player joined the world for the first time).
     */
    flush(key) {
        if (!this.#storage) throw qidbError(`Storage not initialized yet, wait for a player to join.`);
        const time = Date.now();
        let flushed = 0;
        for (const k of key === undefined ? this.#queue.keys() : [toKey(this.#namespace, key)]) {
            if (!this.#queue.has(k)) continue;
            const value = this.#queue.get(k);
            this.#queue.delete(k);
            this.#romSave(k, value);
            flushed++;
        }
        this.settings.logs.flush && log(`Flushed ${flushed} keys. ${Date.now() - time}ms`);
    }

    /**
     * Gets all the keys of your namespace from item database.
     * @return {string[]} All the keys as an array of strings.
     */
    keys() {
        const prefix = this.#namespace + ":";
        const keys = [];
        for (const id of world.structureManager.getWorldStructureIds())
            if (id.startsWith(prefix) && !this.#queue.has(id)) keys.push(id.slice(prefix.length));
        for (const id of this.#queue.keys()) keys.push(id.slice(prefix.length));
        this.settings.logs.keys && log(`Got the list of all the ${keys.length} keys.`);
        return keys;
    }

    /**
     * Gets all the values of your namespace from item database (takes some time if values aren't already loaded in quickAccess).
     * @return {T[]} All the values.
     */
    values() {
        const time = Date.now();
        const values = this.keys().map(key => this.get(key));
        this.settings.logs.values && log(`Got the list of all the ${values.length} values. ${Date.now() - time}ms`);
        return values;
    }

    /**
     * Clears all, CAN NOT REWIND.
     */
    clear() {
        const time = Date.now();
        const keys = this.keys();
        keys.forEach(key => this.delete(key));
        this.settings.logs.clear && log(`Cleared, deleted ${keys.length} values. ${Date.now() - time}ms`);
    }
}
