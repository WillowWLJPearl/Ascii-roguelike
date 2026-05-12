// src/templates/entities.js
// Templates can have inline functions (tick/spawn) and inherit via `extends`.
const ENT_TEMPLATES = {
    base: {
        speed: 0.16,
        type: 'entity',
        name: 'Entity',
        char: '?',
        color: '#fff',
        overlays: { top: [], bl: [], br: [] },
        inventory: [],
        traits: [],
        slots: { hotbar: 0 },
        FOV_RADIUS: 6,
        meta: {},

        // called each server tick if present
        tick(self, ctx) {
            // default: do nothing
        },

        // optional: return >0 to allow spawning on a chunk
        spawn(ctx) { return 0; } // default: never auto-spawn
    },

    player: {
        extends: 'base',
        type: 'player',
        name: 'Player',
        char: '@',
        color: '#7cf',
        slots: { hotbar: 9 },
        FOV_RADIUS: 8,
        tick(self, ctx) {
            // stamina regen example
            const s = self.stamina;
            if (s && s.currentStamina < s.maxStamina && (ctx.serverTick % 10) === 0) {
                s.currentStamina++;
            }
        }
    },

    chest: {
        extends: 'base',
        type: 'chest',
        name: 'Chest',
        char: 'C',
        color: 'rgba(76,46,8,1)',
        inventory: ['sword'],
        FOV_RADIUS: 0,
        spawn(ctx) {
            // allow sparse chests in overworld
            if (ctx.mapId !== 'overworld') return 0;
            const v = Math.abs((ctx.cx * 73856093) ^ (ctx.cy * 19349663)) % 9;
            return v === 0 ? 1 : 0;
        }
    }
};

module.exports = { ENT_TEMPLATES };
