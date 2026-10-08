/**
 * grammar-engine.js — Ком-Ком Грамматический движок v3.1
 * Slot-based. 10 режимов: want | hurt | standalone | dialog |
 *                         feeling | question | state | request | past | address
 */
(function (root) {
  'use strict';

  const PREPOSITION_VARIANTS = {
    'о':  { vowels: 'аеёиоуыэюя', extended: 'об' },
    'с':  { clusters: ['мн','вс','ств','зд','сн'], extended: 'со' },
    'в':  { clusters: ['мн','вс','фл','фр'], extended: 'во' },
    'к':  { clusters: ['мн','вс'], extended: 'ко' }
  };

  const PLURAL_WORDS = new Set([
    'штаны','очки','ножницы','брюки','джинсы','трусы',
    'носки','перчатки','санки','качели','шорты'
  ]);

  const DESIRE_FORMS = {
    'Я':'хочу','Ты':'хочешь','Он':'хочет','Она':'хочет',
    'Оно':'хочет','Мы':'хотим','Вы':'хотите','Они':'хотят'
  };

  const BUCKETS = {
    objects: { name:'objects', label:'📦 Объекты', accepts:['object','clothing','food','drink','pain','transport'] },
    people:  { name:'people',  label:'👥 Люди',    accepts:['person'] },
    pets:    { name:'pets',    label:'🐾 Питомцы', accepts:['pet'] },
    places:  { name:'places',  label:'📍 Места',   accepts:['place'] },
    time:    { name:'when',    label:'⏰ Время',   accepts:['time'] }
  };

  class GrammarEngine {
    constructor(cards) { this.cards = cards || {}; }

    setCards(cards) { this.cards = cards || {}; return this; }
    getCard(id) { return this.cards[id] || null; }

    /* ======================== MIGRATION ======================== */
    static migrateCard(card) {
      if (!card) return card;
      const g = card.grammar || {};
      const meta = card.metadata || {};

      if (card.forms && !g.forms) g.forms = card.forms;
      if (g.forms) g.forms = GrammarEngine._normalizeForms(g.forms);

      // Places: "locative: на площадке" → prepositions.prepositional + forms.prepositional
      if (card.type === 'place' && g.forms && g.forms.locative && !g.forms.prepositional) {
        const m = String(g.forms.locative).match(/^(в|на|под|за)\s+(.+)$/i);
        if (m) {
          g.forms.prepositional = m[2];
          g.prepositions = g.prepositions || {};
          if (!g.prepositions.prepositional) g.prepositions.prepositional = m[1].toLowerCase();
        } else {
          g.forms.prepositional = g.forms.locative;
        }
        delete g.forms.locative;
      }

      // Actions: legacy → slots
      if (['action','help','request'].includes(card.type) && !g.slots) {
        const pain = g.painConstruction ?? meta.painConstruction ?? false;
        const standalone = g.isStandalone ?? meta.isStandalone ?? false;
        const reqSubj = g.requiresSubject ?? meta.requiresSubject ?? true;
        const reqDes = g.requiresDesire ?? meta.requiresDesire ?? true;

        if (!g.mode) {
          g.mode = pain ? 'hurt'
                 : (standalone && !reqSubj && !reqDes ? 'standalone' : 'want');
        }

        const args = g.arguments || GrammarEngine._legacyToArguments(g, meta);
        const slots = [];
        let auto = 1;
        for (const [key, bucket] of Object.entries(BUCKETS)) {
          const arg = args[key];
          if (!arg) continue;
          const slot = {
            name: bucket.name, label: bucket.label, accepts: bucket.accepts,
            order: arg.order || auto++
          };
          if (arg.preposition) slot.preposition = arg.preposition;
          if (arg.case) slot.case = arg.case;
          if (arg.max) slot.max = arg.max;
          if (arg.allowedIds) slot.allowedIds = arg.allowedIds.slice();
          slots.push(slot);
        }
        if (slots.length) g.slots = slots;

        ['arguments','allowedTypes','maxCounts','allowedObjects','directObject',
         'objectPreposition','objectCase','personPreposition','personCase',
         'painConstruction','isStandalone','requiresSubject','requiresDesire'].forEach(k => delete g[k]);
      }

      if (!card.tags) card.tags = [];

      card.grammar = g;
      delete card.metadata;
      if (card.forms) delete card.forms;
      return card;
    }

    static _legacyToArguments(g, meta) {
      const allowed = g.allowedTypes || meta.allowedWith || [];
      if (!allowed.length) return {};
      const max = g.maxCounts || {
        people: meta.maxPeople, pets: meta.maxPets,
        places: meta.maxPlaces, objects: meta.maxObjects
      };
      const direct = g.directObject ?? meta.directObject ?? false;
      const out = {};
      let order = 1;
      for (const type of allowed) {
        const a = { order: order++ };
        if (max[type] > 0) a.max = max[type];
        if (type === 'objects') {
          const p = g.objectPreposition || meta.objectPreposition;
          if (p) { a.preposition = p; a.case = g.objectCase || meta.objectCase || 'instrumental'; }
          else a.case = 'accusative';
          const arr = g.allowedObjects || meta.allowedObjects;
          if (arr) a.allowedIds = arr;
        } else if (type === 'people') {
          const p = g.personPreposition || meta.personPreposition;
          if (p) { a.preposition = p; a.case = g.personCase || meta.personCase || 'instrumental'; }
          else if (direct) a.case = 'accusative';
          else { a.preposition = 'с'; a.case = 'instrumental'; }
        } else if (type === 'pets') {
          if (direct) a.case = 'accusative';
          else { a.preposition = 'с'; a.case = 'instrumental'; }
        } else if (type === 'places') {
          a.preposition = 'в'; a.case = 'prepositional';
        }
        out[type] = a;
      }
      if (allowed.length && !out.time) out.time = { order: order++ };
      return out;
    }

    static _normalizeForms(forms) {
      const out = { ...forms };
      if (out['с'] && !out.instrumental) out.instrumental = String(out['с']).replace(/^с\s+/i,'').trim();
      if (out['с']) delete out['с'];
      if (out['на'] && !out.prepositional) out.prepositional = String(out['на']).replace(/^на\s+/i,'').trim();
      if (out['на']) delete out['на'];
      return out;
    }

    /* ======================== HELPERS ======================== */
    getForms(card) { return (card && ((card.grammar && card.grammar.forms) || card.forms)) || {}; }
    getPrepositions(card) { return (card && card.grammar && card.grammar.prepositions) || {}; }

    formatWord(card, caseName) {
      if (!card) return '';
      const forms = this.getForms(card);
      const cs = caseName || 'nominative';
      return String(forms[cs] || forms.nominative || card.text || '').trim();
    }

    effectivePreposition(card, slot) {
      const overrides = this.getPrepositions(card);
      if (slot.case && overrides[slot.case] !== undefined) return overrides[slot.case] || null;
      return slot.prep || slot.preposition || null;
    }

    adaptPreposition(prep, firstWord) {
      if (!prep || !firstWord) return prep;
      const v = PREPOSITION_VARIANTS[prep];
      if (!v) return prep;
      const w = String(firstWord).toLowerCase();
      if (v.vowels && w && v.vowels.includes(w[0])) return v.extended;
      if (v.clusters && v.clusters.some(c => w.startsWith(c))) return v.extended;
      return prep;
    }

    joinWords(words) {
      const w = (words || []).filter(Boolean);
      if (!w.length) return '';
      if (w.length === 1) return w[0];
      if (w.length === 2) return w[0] + ' и ' + w[1];
      return w.slice(0, -1).join(', ') + ' и ' + w[w.length - 1];
    }

    isPlural(card) {
      if (!card || !card.grammar) return false;
      if (card.grammar.isPluralOnly) return true;
      return PLURAL_WORDS.has(String(card.text || '').toLowerCase().trim());
    }

    pluralizeVerb(verb) {
      if (verb === 'болит') return 'болят';
      if (verb === 'болело') return 'болели';
      return verb;
    }

    /* ======================== SLOT ACCEPTANCE ======================== */
    slotAcceptsCard(slot, card) {
      if (!slot || !card) return false;
      if (slot.allowedIds && slot.allowedIds.length) {
        return slot.allowedIds.includes(card.id);
      }
      if (slot.acceptsTags && slot.acceptsTags.length) {
        const cardTags = (card.tags || []).concat(card.type ? [card.type] : []);
        return slot.acceptsTags.some(t => cardTags.includes(t));
      }
      return (slot.accepts || []).includes(card.type);
    }

    slotsForCardType(actionId, cardType) {
      const action = this.getCard(actionId);
      if (!action || !action.grammar || !action.grammar.slots) return [];
      return action.grammar.slots.filter(s => (s.accepts || []).includes(cardType));
    }

    slotMax(actionId, slotName) {
      const action = this.getCard(actionId);
      if (!action) return 0;
      const slot = (action.grammar.slots || []).find(s => s.name === slotName);
      return (slot && slot.max) || 0;
    }

    /* ======================== BUILD ======================== */
    build(phrase) {
      if (!phrase) return '';

      // Фраза без действия: только субъект/желание → "Я не хочу", "Я", "Хочу"
      if (!phrase.actionId) {
        if (phrase.subject && phrase.desire) return phrase.subject + ' ' + phrase.desire;
        if (phrase.subject) return phrase.subject;
        if (phrase.desire) return phrase.desire;
        return '';
      }

      const action = this.getCard(phrase.actionId);
      if (!action) return '';

      const g = action.grammar || {};
      const mode = g.mode || 'want';
      const slots = (g.slots || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99));

      const parts = [];

      // Prefix
      const prefix = this._buildPrefix(mode, phrase, action);
      if (prefix) parts.push(prefix);

      // Verb (с согласованием для hurt)
      let verb = action.text;
      if (mode === 'hurt') {
        const firstSlot = slots[0];
        const ids = firstSlot && phrase.slots && phrase.slots[firstSlot.name];
        if (ids && ids.length) {
          const c = this.getCard(ids[0]);
          if (this.isPlural(c)) verb = this.pluralizeVerb(verb);
        }
      }
      if (verb) parts.push(verb);

      // Слоты — сливаем однотипные предлоги
      const groups = [];
      for (const slot of slots) {
        const ids = phrase.slots && phrase.slots[slot.name];
        if (!ids || !ids.length) continue;
        for (const id of ids) {
          const card = this.getCard(id);
          if (!card) continue;
          const word = this.formatWord(card, slot.case);
          if (!word) continue;
          const prep = this.effectivePreposition(card, slot);
          const last = groups[groups.length - 1];
          if (prep && last && last.prep === prep) {
            last.words.push(word);
          } else {
            groups.push({ prep, words: [word] });
          }
        }
      }

      for (const grp of groups) {
        const joined = this.joinWords(grp.words);
        if (grp.prep) {
          parts.push(this.adaptPreposition(grp.prep, grp.words[0]) + ' ' + joined);
        } else {
          parts.push(joined);
        }
      }

      let result = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      // Постобработка
      if (result) result = result.charAt(0).toUpperCase() + result.slice(1);
      if (mode === 'question' && result && !result.endsWith('?')) result += '?';

      return result;
    }

    _buildPrefix(mode, phrase, action) {
      switch (mode) {
        case 'hurt':      return 'У меня';
        case 'standalone': return '';
        case 'dialog':    return '';
        case 'feeling':   return 'Мне';
        case 'question':  return '';
        case 'state':     return phrase.subject || 'Я';
        case 'past':      return phrase.subject || 'Я';
        case 'request':   return phrase.subject ? phrase.subject + ',' : '';
        case 'address':   return phrase.subject ? phrase.subject + ',' : '';
        case 'statement': return phrase.subject || 'Я';
        case 'want':
        default: {
          const s = phrase.subject || 'Я';
          const d = phrase.desire || DESIRE_FORMS[s] || 'хочу';
          return s + ' ' + d;
        }
      }
    }

    /* ======================== MODE METADATA ======================== */
    /**
     * Возвращает, какие поля UI имеет смысл показывать для данного mode.
     * Используется редактором и главным экраном.
     */
    static modeInfo(mode) {
      const MAP = {
        want:       { subject: true,  desire: true,  slots: true,  question: false },
        hurt:       { subject: false, desire: false, slots: true,  question: false },
        standalone: { subject: false, desire: false, slots: true,  question: false },
        dialog:     { subject: false, desire: false, slots: false, question: false },
        feeling:    { subject: false, desire: false, slots: true,  question: false },
        question:   { subject: false, desire: false, slots: true,  question: true  },
        state:      { subject: true,  desire: false, slots: false, question: false },
        request:    { subject: true,  desire: false, slots: true,  question: false },
        past:       { subject: true,  desire: false, slots: false, question: false },
        address:    { subject: true,  desire: false, slots: true,  question: false }
      };
      return MAP[mode] || MAP.want;
    }
  }

  root.GrammarEngine = GrammarEngine;
})(typeof window !== 'undefined' ? window : globalThis);