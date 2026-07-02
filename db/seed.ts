/**
 * Seed the Erendyl Codex with content pulled from the vault's own
 * player-facing sources: 07_Player_Handouts/, the five PC files, the
 * faction files, the Chronicle, and the Wildheart Core's player sheet.
 *
 * DM-secrets guardrail: anything gated behind a `> [!DM]` callout, a
 * "DM Reserved" section, or "what the party does not know" in the source
 * files has been deliberately left out or trimmed. A few entries (Old
 * Camor, the Dusk Council, the Draconic Brotherhood) are seeded but marked
 * revealed: false, since they are either not-yet-played or still-secret —
 * flip them on from the admin panel once they're revealed at the table.
 *
 * Safe to re-run: upserts are keyed by name, so running this twice updates
 * existing rows instead of duplicating them.
 */
import {
  adminUpsertMoon,
  adminUpsertRegion,
  adminUpsertLocation,
  adminUpsertCharacter,
  adminUpsertFaction,
  adminUpsertStoryline,
  adminUpsertArtifact,
  adminUpsertTimelineEvent,
} from "../src/lib/admin-queries";
import { ensureSchema, getDb, newId, LEGACY_CAMPAIGN_ID } from "../src/lib/db";

async function linkCharacterFaction(characterId: string, factionId: string, role?: string) {
  await getDb().execute({
    sql: "INSERT OR IGNORE INTO character_factions (id, character_id, faction_id, role) VALUES (?,?,?,?)",
    args: [newId(), characterId, factionId, role ?? null],
  });
}

async function main() {
  await ensureSchema();
  console.log("Seeding the Erendyl Codex...");

  // ---- Moons ----------------------------------------------------------
  const moon = {
    wyr: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Wyr",
      cycle: "~4-5 years",
      domain: "Night & the Void",
      description:
        "The Black Moon. The smallest and most distant moon, coated in a substance that absorbs all light — a wound in the sky. Official god of Antica. Appears for only a few days at a time before passing behind a larger body. Among most other peoples, sighting Wyr is a sign of misfortune.",
      color: "#1a1a1a",
      isGoddess: false,
      sortOrder: 1,
    }),
    vyrene: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Vyrene",
      cycle: "~2 years",
      domain: "Light",
      description:
        "The Silver Moon. The opposite of Wyr — reflects light absolutely, glowing strong and white, sometimes blinding even by day. Official god of the kingdom that bears its name.",
      color: "#e8e6d8",
      isGoddess: false,
      sortOrder: 2,
    }),
    krevan: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Krevan",
      cycle: "~5 years",
      domain: "Spirits & the Sea",
      description:
        "The Beautiful Moon. A large moon whose surface shifts colors based on its position; the closest moon to the world, and the one that controls the tides. Official god of Mollin. When Krevan's cycle synchronizes with Vyrene's, it blazes in every color of the rainbow — the Convergence of Lights, when Camor hosts the greatest festival in Erendyl.",
      color: "#5ec1c4",
      isGoddess: false,
      sortOrder: 3,
    }),
    vorryn: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Vorryn",
      cycle: "~6 months",
      domain: "Fire",
      description:
        "The Burning Moon. Not truly a moon at all — a body of gas perpetually burning, like a tiny secondary sun, moving faster across the sky than any other moon. Official god of Koleyven. The current king of Koleyven has declared himself a kind of messiah-son of Vorryn, and demands every Vorryn temple be a temple to him as well — a claim not every faithful accepts quietly.",
      color: "#c8622a",
      isGoddess: false,
      sortOrder: 4,
    }),
    aelinda: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Aelinda",
      cycle: "Erratic — longest recorded gap is ten years",
      domain: "Time",
      description:
        "The Wandering Moon. A golden-faced moon whose orbit is unpredictable. The elves of Farheim see Aelinda as a god of wisdom and prophecy; lowlanders feel uneasy about it, since its unpredictability defies the calendars structured around the other moons.",
      color: "#d4af37",
      isGoddess: false,
      sortOrder: 5,
    }),
    saren: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Saren",
      cycle: "~8 years",
      domain: "Sand & the Desert",
      description:
        "The Dust Moon. A dry brown-yellow moon moving elliptically through the sky. The nomads of the Sarine desert treat this moon as their compass and read their calendar by its position.",
      color: "#b08a4e",
      isGoddess: false,
      sortOrder: 6,
    }),
    thyrmis: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Thyrmis",
      cycle: "Unknown",
      domain: "Darkness & Secrets",
      description:
        "The Vanished Moon. A bright blue moon that moves through the sky but is invisible to the naked eye — to see it, one must look through special crystals carved only in Erendyl's deepest caves. Very few worshippers remain in Erendyl today; said to have been worshipped by the dark elves long ago.",
      color: "#3a5a8c",
      isGoddess: true,
      sortOrder: 7,
    }),
    veleth: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Veleth",
      cycle: "Longer than recorded history",
      domain: "Rain & Bloom",
      description:
        "The Still Moon. A green moon, completely smooth, moving so slowly it seems to stand still. Not the official god of any kingdom, but farmers throughout Erendyl make offerings to her. Dark prophecies speak of the day she crosses the horizon — drought will follow. This has never happened.",
      color: "#5a8c5a",
      isGoddess: true,
      sortOrder: 8,
    }),
    morrath: await adminUpsertMoon(LEGACY_CAMPAIGN_ID, {
      name: "Morrath",
      cycle: "Appears only during a full eclipse of all other moons",
      domain: "War & Death",
      description:
        "The Blood Moon. A deep red moon, large and bright, that appears only during a full eclipse of all the other moons. When she appears, war and death follow — her omen has never failed. The only god in Erendyl with no public temples; only small underground cults worship her in secret.",
      color: "#8c1a1a",
      isGoddess: true,
      sortOrder: 9,
    }),
  };

  // ---- Regions ----------------------------------------------------------
  const region = {
    antica: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "Antica",
      type: "Theocracy",
      capital: "Vel Atura",
      government: "Church of Wyr",
      faith: "Wyr",
      moonId: moon.wyr,
      description:
        "The oldest kingdom on the continent. Small but fanatically unified, Antica has resisted foreign conquest repeatedly through the sheer stubborn loyalty of its citizens. Few standing armies; the Church guards maintain order with the rigor expected of priest-rulers. Outsiders find Antica unwelcoming.",
      sortOrder: 1,
      revealed: true,
    }),
    koleyven: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "Koleyven",
      type: "Absolute Monarchy",
      capital: "Vorreth",
      government: "Aldorin dynasty, under King Talib",
      faith: "Vorryn",
      moonId: moon.vorryn,
      description:
        "The largest and most powerful kingdom in Erendyl. Vast armies, towering fortified cities, and a king spoken of the way people speak of forces of nature. The current king, Talib, is whispered to be immortal — succeeded across generations by improbable heirs whose legitimacy nobility never questions. The empire stretches from Sarine's desert almost to the Maynar Sea.",
      sortOrder: 2,
      revealed: true,
    }),
    vyrene: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "Vyrene",
      type: "Mercantile Council",
      capital: "Solveth",
      government: "The Accord — a council of twelve guild masters",
      faith: "Vyrene",
      moonId: moon.vyrene,
      description:
        "The smallest kingdom, with almost no army, but the wealthiest in Erendyl — and possibly the wealthiest in the known world. Most of its wealth flows through Camor, the port city where all foreign trade passes. The only kingdom where citizens of every other kingdom can visit freely, and the most liberal, though slavery still exists here.",
      sortOrder: 3,
      revealed: true,
    }),
    mollin: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "Mollin",
      type: "Constitutional Monarchy",
      capital: "Verantum",
      government: "Crown + the Arcanists' Assembly",
      faith: "Krevan",
      moonId: moon.krevan,
      description:
        "Built on the principle that raw magic is crude and wild, and only knowledge can master it. A kingdom of research, libraries, and the Tower of Verantum — the greatest academy of arcane study in the world. Mollin produces the finest weapons, technology, and architecture in Erendyl. Its relationship with Koleyven is one of cold tension restrained by the Treaty of Embers.",
      sortOrder: 4,
      revealed: true,
    }),
    farheim: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "Farheim",
      type: "Council of Elders",
      capital: "The High Seat",
      government: "The Council of Elders",
      faith: "Aelinda",
      moonId: moon.aelinda,
      description:
        "Home of the elves, who live in near-complete isolation atop the impossibly high peaks of the Farheim mountains. Without some form of flying creature, the climb is virtually impossible. Elves descend to wander among the lowland kingdoms occasionally, but no foreigner has ever been granted entry to Farheim itself.",
      sortOrder: 5,
      revealed: true,
    }),
    sarine: await adminUpsertRegion(LEGACY_CAMPAIGN_ID, {
      name: "The Sarine Desert",
      type: "Nomadic Territory",
      capital: undefined,
      government: "None — nomadic, clan-based",
      faith: "Saren",
      moonId: moon.saren,
      description:
        "Not a true kingdom by any historian's account — but ignoring the lives there is a mistake few survive to learn from. A strip of desert in the heart of the continent, along Koleyven's southern border, inhabited mostly by beastfolk living nomadic lives in small tight-knit communities. Some trade, some raid, and most do both.",
      sortOrder: 6,
      revealed: true,
    }),
  };

  // ---- Locations ----------------------------------------------------------
  const location = {
    velAtura: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Vel Atura",
      type: "Capital City",
      regionId: region.antica,
      description:
        "The Eternal Hold — the oldest city in the known world, and the seat of the Church of Wyr. Home to a massive theological archive. Senior priests practice void-meditation, said to reveal truths invisible to ordinary perception.",
      revealed: true,
    }),
    vorreth: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Vorreth",
      type: "Capital City",
      regionId: region.koleyven,
      description:
        "The Iron City — Vorryn's Hold. A black iron-stone fortress capital, inhabited exclusively by the royal family, the high nobility, and generational slaves who never leave its walls.",
      revealed: true,
    }),
    verantum: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Verantum",
      type: "Capital City",
      regionId: region.mollin,
      description:
        "The Tower City — home to the Tower of Verantum, the greatest arcane academy on the continent. Its graduates can be found in every major city in Erendyl, and its magical infrastructure powers, lights, and waters Mollin's cities and fields.",
      revealed: true,
    }),
    arkenfell: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Arkenfell",
      type: "City",
      regionId: region.mollin,
      description:
        "A woodland city in eastern Mollin with magical canal infrastructure. Home to the Monastery of Krevan, where Anika Salvatore was raised.",
      revealed: true,
    }),
    solveth: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Solveth",
      type: "Capital City",
      regionId: region.vyrene,
      description: "Where the Accord — Vyrene's council of twelve guild masters — meets in the Hall of the Twelve.",
      revealed: true,
    }),
    camor: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "Camor",
      type: "Cliff-Built Fortified City",
      regionId: region.vyrene,
      description:
        "The City of Dawn — the campaign's primary setting. Built on a flat mountaintop plateau at the edge of a sheer coastal cliff dropping several hundred meters to the Maynar Sea. Below the cliff sits the Harborfoot and the Maw, Camor's natural harbor. The city and docks are connected by three massive cliff elevators. Camor's upper city is divided into four concentric ring-walls — Circle A (the Heart, Dawn Keep and the highest nobility), Circle B (the Wealthy Quarter, including the Crawling Toad inn), Circle C (the Festival Belt, arenas and shrines), and Circle D (the Outer Ring, including the Dustmarket and Pilgrim's Row). Camor hosts the Convergence of Lights festival every five years, timed to a rare alignment of the moons.",
      revealed: true,
    }),
    theHighSeat: await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
      name: "The High Seat",
      type: "Capital City",
      regionId: region.farheim,
      description: "The elvish spire-city atop Farheim's highest mountain peak, seat of the Council of Elders.",
      revealed: true,
    }),
  };

  const westernvorth = await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
    name: "The Westernvorth Forest",
    type: "Forest",
    regionId: region.koleyven,
    description:
      "A vast hardwood forest covering much of Koleyven's southwestern frontier, extending into the borderlands with Mollin. Dense, well-watered, rising into hill country in its western reaches — terrain that favors small mobile units over large-scale operations. The forest has been outside meaningful state control for generations, and is home to the Order of Vorryn's hidden camps.",
    revealed: true,
  });

  const harborfoot = await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
    name: "The Harborfoot",
    type: "District",
    parentId: location.camor,
    regionId: region.vyrene,
    description:
      "The dockside district built into and along the base of Camor's cliff. Raw, unpolished, and functional compared to the upper city — the festival's noise is muffled here by the cliff above. Currently home to a growing population of refugees fleeing the Mollin border crisis.",
    revealed: true,
  });

  const tunnels = await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
    name: "The Tunnels Beneath Camor",
    type: "Tunnel Network",
    parentId: location.camor,
    regionId: region.vyrene,
    description:
      "A network of drainage tunnels and old defensive works beneath Camor, connecting the city's dungeon to the Harborfoot docks. The party discovered and used this route while freeing several prisoners, escaping through it to the docks at dawn. Its full extent is still largely unknown to them.",
    revealed: true,
  });

  const obsidianSanctum = await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
    name: "The Obsidian Sanctum",
    type: "Ancient Temple",
    parentId: location.camor,
    regionId: region.vyrene,
    description:
      "An ancient temple built entirely of black obsidian on Camor's outskirts, rumored cursed and universally avoided. The party sheltered here after a harrowing night freeing prisoners from the city's dungeon — only to find it was not as abandoned as its reputation suggested. They fought through waves of undead guardians and defeated a mysterious ashen priest, discovering a strange stone of impossible green light in the ashes: the Wildheart Core.",
    revealed: true,
  });

  const oldCamor = await adminUpsertLocation(LEGACY_CAMPAIGN_ID, {
    name: "Old Camor",
    type: "Ruin",
    parentId: location.camor,
    regionId: region.vyrene,
    description:
      "The original settlement, abandoned generations ago when the city climbed to its current clifftop position. Rumored cursed and haunted ever since — a reputation that keeps most people away entirely.",
    revealed: false,
  });

  // ---- Characters ----------------------------------------------------------
  const anika = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Anika Salvatore",
    isPc: true,
    isAlive: true,
    race: "Tiefling",
    charClass: "Cleric of Krevan",
    status: "Active — in Camor with the party",
    summary: "The tiefling cleric of Krevan. A survivor of two fires, sharp-tongued and ferociously loyal to those she has decided are hers.",
    bio:
      "Anika Salvatore was born into a wealthy merchant family in Vyrene and lost everything before she could remember it. Raised at the Monastery of Krevan in Arkenfell after being delivered there as an infant with an unsigned note, she grew up tolerated by the monastery's head and tormented by its acolytes — with one exception: the kindly Father Peregrin, who watched over her in quiet ways for years.\n\nWhen a man calling himself her brother, Julian, arrived at the monastery, he told her the truth of her family: a fire that had destroyed their estate, an uncle who orchestrated it, and an old pact recorded in an Antican archive. She stole the scroll he asked for — and paid for it when Antican knights burned the monastery to retrieve it. She escaped, immune to the flames, while Father Peregrin held the knights off behind her.\n\nShe found her younger brother Noah at a forest fork near the Westernvorth, and the two of them — along with a boy named Micah who nearly killed her defending him — have traveled together ever since, eventually joining Kaelomi, Turi, and Henryhan on the road to Camor.\n\nAnika is direct, unsentimental, and does not perform piety, though her faith in Krevan is genuine. She is quietly beginning to wonder what her own fae heritage means, and whether it connects to a moon she does not yet have the framework to name.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const noah = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Noah Salvatore",
    isPc: true,
    isAlive: true,
    race: "Aasimar",
    charClass: "Paladin",
    status: "Active — in Camor with the party",
    summary: "Born Thomas Salvatore. Raised by the underground Order of Vorryn, and the closest thing Micah has to family.",
    bio:
      "Noah was born Thomas Salvatore, the youngest of three siblings in a Vyrene merchant house destroyed by fire when he was a toddler. He has only fragmentary memories from that time — a ritual circle, colored lights, a cold extraction of something he couldn't name. He was rescued as a small child and placed at an orphanage in Caldrin under a new name.\n\nAt around age eight, scouts from the underground Order of Vorryn identified him as an Aasimar and brought him to their hidden camp in the Westernvorth Forest, where he was raised and trained by the Order's Master-at-Arms, Raynar — who became, in every way but name, his father. There he also met Micah, a remarkably perceptive ten-year-old boy he began training in secret, and who declared himself Noah's squire without asking permission.\n\nWhen a stranger named Julian arrived at the camp claiming a connection to Noah's past, Raynar recognized a trap and ordered the camp relocated — but Noah went to the meeting anyway, bringing Micah partway. He found Anika instead of Julian, and the recognition between them — slow, halting, real — became the seed of the party that would eventually reach Camor.\n\nNoah is composed, watchful, and carries himself with the quiet discipline of someone who has been training for something since before he understood what. His bond with Micah is the center of his life, even if he rarely says so aloud.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const kaelomi = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Kaelomi",
    isPc: true,
    isAlive: true,
    race: "Leonin",
    charClass: "Barbarian",
    status: "Active — in Camor with the party",
    summary: "A Leonin out of the Sarine sands, looking for a different life than the one his clan gave him.",
    bio:
      "Kaelomi came out of the Sarine desert with no clear plan beyond the need to be somewhere else. He grew up among scavenger clans that lived more by raiding than by trade, and most of his life has involved some form of crime — scavenging ruins, raiding caravans, stealing from those whose protection was insufficient. He isn't proud of it, and isn't yet ashamed of it either.\n\nHe drifted east through Mollin and Vyrene, fell in with the merchant caravan carrying Anika, Noah, and Micah, and fought alongside them when raiders ambushed it in the desert. He fought in Camor's festival arena on the first day, alongside Henryhan, and won — barely.\n\nKaelomi is large, scarred, and quieter than people expect a Leonin barbarian to be. He hasn't decided whether he wants to go straight, or whether he wants to be a hero. What he has decided, without saying it aloud, is that he wants to keep traveling with these people — because something about them is different from anyone he's spent time with before, and something about the boy Micah, in particular, brings out a gentleness in him he doesn't have words for.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const turi = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Turi",
    isPc: true,
    isAlive: true,
    race: "Dwarf",
    charClass: "Bard",
    status: "Active — in Camor with the party",
    summary: "A dwarf bard who left Antica's religious dogmatism behind for music, stories, and the open road.",
    bio:
      "Turi was born and raised in Antica, where the austere certainty of the Wyr faith never spoke to her the way music did. She crossed the Veiled Pass into Mollin as soon as she could and never went back, living as an itinerant bard trading songs for a bed and enough coin to keep moving.\n\nShe heard about the Convergence of Lights in Camor — the great festival, the multi-moon alignment, the visiting performers from across the sea — and drifted east to see it, joining a caravan that became the party.\n\nTuri is curious, quick-witted, and genuinely unsentimental about formal religion of any flavor. She is, for now, the closest thing the party has to an outside observer — present because she likes these people, not because she has a personal stake in the mysteries they're chasing. That may not last.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const micah = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Micah",
    isPc: false,
    isAlive: true,
    race: "Human (apparent)",
    charClass: undefined,
    status: "Squire to Noah Salvatore",
    summary: "A remarkably perceptive ten-year-old boy who declared himself Noah's squire and has never looked back.",
    bio:
      "Micah was raised alongside Noah at the Order of Vorryn's hidden camp in the Westernvorth Forest, where he became the camp's finest young rider and — in secret — Noah's trainee in swordcraft. His perceptiveness borders on the uncanny; he has a way of reading people and situations that unsettles and disarms in equal measure.\n\nWhen Noah rode out to a meeting at a forest fork, Micah insisted on coming, and ended up charging down a hill to defend Noah from a stranger he took for a threat — only to be met with patience rather than violence, and to end up sharing bread with that same stranger within minutes. He declared himself Noah's squire on the spot and has traveled with the party ever since, currently waiting for them at a Camor tavern while they attend to business in the city.\n\nThere is something about Micah — a calm that settles over people at his touch, a stillness that doesn't quite fit an ordinary child — that the party has noticed but not yet explained.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const sera = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Sera",
    isPc: false,
    isAlive: true,
    race: "Human",
    charClass: undefined,
    status: "Rescued, shaken, rebuilding trust",
    summary: "A halfling merchant's wife, freed from Camor's dungeon by the party — and the reason their worst night happened.",
    bio:
      "Sera was imprisoned in Camor's dungeon on false charges fabricated by a rival stallholder, and freed by the party in a rescue that cost far more than anyone expected. Grateful and eager to help, she led the party to what she believed was a safe hiding place outside the city — an ancient obsidian temple she remembered from her own past as somewhere she'd once found comfort.\n\nIt was not what she thought it was. Whatever waited there was not pleased to see Noah, and demanded to know where someone else was. Sera did not know what she had done until the fighting started around her.\n\nShe survived the night, alive but shaken, and is now trying to find her footing again with the people she nearly delivered into danger. Where her story goes from here — quiet exile, rebuilt trust, or something else — is still being written.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const julian = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Julian Salvatore",
    isPc: false,
    isAlive: true,
    race: "Human",
    charClass: undefined,
    status: "Elsewhere in Erendyl",
    summary: "The eldest Salvatore sibling, returned from years presumed dead to reunite — and use — his family.",
    bio:
      "Tall, gold-armored, with one scarred red eye and one near-blind pale blue one, Julian arrived at Anika's monastery and later at Noah's forest camp bearing the truth of a family both of them thought they'd lost: a fire, an uncle's betrayal, an ancient pact recorded in a foreign archive. He set both of his younger siblings on paths that reunited them — asking Anika to steal a scroll, and drawing Noah to a fateful meeting at a forest crossing.\n\nWhat Julian wants, and what he owes to whatever kept him alive during his years away, remains one of the party's open questions. He is currently elsewhere in Erendyl.",
    revealed: true,
    locationId: undefined,
    factionIds: [],
  });

  const maximus = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Maximus Salvatore",
    isPc: false,
    isAlive: true,
    race: "Human",
    charClass: undefined,
    status: "Holds the Weapons Guild seat in Vyrene",
    summary: "Anika and Noah's uncle, who inherited the family's seat on the Accord after the fire that killed their parents.",
    bio:
      "Maximus has held House Salvatore's Weapons Guild seat on Vyrene's Accord for years, expanding its profits and cultivating allies among the council's most powerful guilds. He has never publicly answered for the suspicions that have quietly followed him since his brother's family died — and no one, so far, has surfaced to make him.\n\nWhether Anika and Noah ever contest his position is a question neither of them has yet had reason to answer.",
    revealed: true,
    locationId: undefined,
    factionIds: [],
  });

  const peregrin = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Father Peregrin",
    isPc: false,
    isAlive: false,
    race: "Human",
    charClass: undefined,
    status: "Presumed dead — no body seen",
    summary: "The one person at Anika's monastery who was ever kind to her, and the one who bought her time to escape.",
    bio:
      "An old man with the soft grin of a servant and, as Anika discovered only in the moment it mattered, the calloused hands of a fighter. He watched over her for years at the Monastery of Krevan without ever explaining why, and when Antican knights came for the scroll she had stolen, he fought them with a battleaxe nobody at the monastery had known he possessed — buying her enough time to escape with the scroll in hand.\n\nAnika heard him fall. She did not see a body. Whether he survived is, for now, unknown.",
    revealed: true,
    locationId: undefined,
    factionIds: [],
  });

  const raynar = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Raynar",
    isPc: false,
    isAlive: true,
    race: "Human",
    charClass: undefined,
    status: "Master-at-Arms, Order of Vorryn — relocated camp, Westernvorth",
    summary: "The Order of Vorryn's Master-at-Arms, and the closest thing to a father Noah has ever known.",
    bio:
      "Raynar commanded the Westernvorth camp where Noah was raised and trained from childhood. Not affectionate in any conventional sense, but real and total in his commitment — Noah understood by the time he was twelve that Raynar would die for him if it came to that.\n\nWhen Julian's visit threatened to expose the camp, Raynar ordered it relocated, gave Noah his own cloak and the Order's flame insignia, and told him: \"When the black moon appears again, we will meet. Be the knight I know you were born to be.\" He has not been seen since.",
    revealed: true,
    locationId: westernvorth,
    factionIds: [],
  });

  const ossian = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Brother Ossian",
    isPc: false,
    isAlive: true,
    race: "Human",
    charClass: undefined,
    status: "Encountered in Camor, allowed to leave",
    summary: "An Antican cleric whose healing carries a hidden cost — and who believes, without doubt, that it's necessary.",
    bio:
      "A brown-robed cleric of Wyr the party encountered healing festival fighters in Camor's medical tent — with a magic that felt wrong in every register: cold instead of warm, extracting rather than restoring. Confronted, he didn't deny what he was doing or run from it. He explained, calmly, that Antica had detected something pressing against the boundary of the world, and that his church was quietly preparing a continental network of marked contacts against the day it arrived.\n\nThe party stopped him from marking anyone further that day, though not everyone he'd already treated was so lucky. He answered every question they asked with the composure of a man who had thought longer about the ethics of what he was doing than any of them had.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  const aldric = await adminUpsertCharacter(LEGACY_CAMPAIGN_ID, {
    name: "Aldric",
    isPc: false,
    isAlive: true,
    race: "Halfling",
    charClass: undefined,
    status: "Waiting near the old tunnel entrance",
    summary: "A halfling merchant whose wife's imprisonment first drew the party into Camor's underworld.",
    bio:
      "Aldric ran a Dustmarket stall with his wife Sera until a rival stallholder framed her for a crime she didn't commit. He asked the party for help freeing her, and has been waiting anxiously near the dungeon's old tunnel entrance ever since — still, as far as he knows, without word of what became of her.",
    revealed: true,
    locationId: location.camor,
    factionIds: [],
  });

  // ---- Factions ----------------------------------------------------------
  const houseSalvatore = await adminUpsertFaction(LEGACY_CAMPAIGN_ID, {
    name: "House Salvatore",
    type: "Noble Merchant House",
    regionId: region.vyrene,
    description:
      "A wealthy and politically significant Vyrene merchant family for three generations, holding the Weapons Guild seat on the Accord. The family's estate burned years ago in a fire that killed the parents and was long believed to have killed all three children as well. All three — Julian, Anika, and Noah — in fact survived, scattered and unaware of each other for most of their lives.",
    goals: "Currently no unified goal — the three surviving heirs have not decided whether to reclaim the family's position.",
    revealed: true,
  });

  const orderOfVorryn = await adminUpsertFaction(LEGACY_CAMPAIGN_ID, {
    name: "The Order of Vorryn",
    type: "Underground Religious-Military Order",
    regionId: region.koleyven,
    description:
      "The underground continuation of the original Vorryn faith, holding that the fire moon is a genuine divine power and that Talib's claim to be its messiah is a political fraud layered onto a real bloodline. The Order has operated in hiding for as long as Talib has reigned, decentralized by design and organized around distributed camps in the Westernvorth forest.",
    goals:
      "Preservation, training, and patient preparation for a day when Talib's official church can be challenged directly — work measured in generations, not seasons.",
    revealed: true,
  });

  const accord = await adminUpsertFaction(LEGACY_CAMPAIGN_ID, {
    name: "The Accord",
    type: "Mercantile Council Government",
    regionId: region.vyrene,
    description:
      "Vyrene's governing body — a council of twelve guild masters, each representing a major commercial sector, meeting in Solveth's Hall of the Twelve. In practice, the Aureate League (banking) and the Tidal Compact (shipping) hold disproportionate influence. The Accord has governed Vyrene for over two hundred years, and there is now no functional distinction between the kingdom's nobility and its mercantile class.",
    goals: "Governs Vyrene's internal affairs and collective foreign policy through council vote.",
    revealed: true,
  });

  const sleepingHand = await adminUpsertFaction(LEGACY_CAMPAIGN_ID, {
    name: "Antica's Sleeping Hand",
    type: "Covert Continental Network",
    regionId: region.antica,
    description:
      "A covert operation run by Antica's Church of Wyr across the entire continent. Antican clerics — operating publicly as healers and traveling priests — mark individuals through their void-healing, an invisible thread that produces no immediate effect but can be activated by senior priests when Wyr next rises. The party learned of this directly through Brother Ossian in Camor: the church believes something is pressing against the boundary of the world, and is quietly preparing a network it believes the surface kingdoms will need — whether they consent to it or not.",
    goals:
      "Build a continent-wide network of marked contacts, ready to be nudged toward specific action when the cosmic moment requires it.",
    revealed: true,
  });

  // ---- Artifacts ----------------------------------------------------------
  await adminUpsertArtifact(LEGACY_CAMPAIGN_ID, {
    name: "The Wildheart Core",
    type: "Wondrous Item",
    rarity: "Unique",
    attunement: true,
    ownerCharacterId: undefined,
    locationId: obsidianSanctum,
    description:
      "A gemstone of wild green light, looted from the ashes of the Ashen Priest in the Obsidian Sanctum. It sits where its bearer's heart should be — their life, their mind, their magic. Nobody has bonded with it yet.",
    mechanics:
      "When its bearer casts a spell of 1st level or higher, the Core sometimes surges — erupting into an unpredictable effect. It grows hungry with use, and left unfed its surges turn crueler and more frequent. It is sated by dismantling other magic items into it, which also feeds its growth along three lines: Control (mastery over its chaos), Resonance (the raw strength of its effects), and Capacity (how much it can hold before hungering again). The bearer does not start with a list of what it does — only what they've personally witnessed.",
    revealed: true,
  });

  // ---- Storylines ----------------------------------------------------------
  await adminUpsertStoryline(LEGACY_CAMPAIGN_ID, {
    title: "Sera's Redemption",
    status: "Active",
    priority: "High",
    summary:
      "Freed from Camor's dungeon, Sera led the party to what she believed was a safe hiding place — and unwittingly delivered them into terrible danger instead.",
    description:
      "At an ancient obsidian temple on Camor's outskirts, Sera knelt before something in the dark that she believed was a protector from her own childhood, and asked it to accept 'the child' she'd brought. What answered was not pleased with Noah, and demanded to know where someone else was. Sera didn't know what she'd done until the fighting started around her.\n\nShe survived the night, alive but shaken — the first time since anyone has known her that she's had nothing left to hide. How the party treats her now, and how she rebuilds what trust she can, is still unfolding.",
    locationId: obsidianSanctum,
    nextStep:
      "Sera's path forward — trust rebuilt, quiet self-exile, or an attempt to make things right — depends on how the party responds to her.",
    revealed: true,
    characterIds: [sera, anika, noah, kaelomi, turi],
  });

  await adminUpsertStoryline(LEGACY_CAMPAIGN_ID, {
    title: "Kelvani and the Vanished Crystal",
    status: "Active",
    priority: "Medium",
    summary:
      "A captured Drow woman turned to smoke, killed a dozen guards, and vanished from Camor's dungeon during the party's rescue of Sera.",
    description:
      "During the same chaos that freed Sera, a heavily chained prisoner's cell exploded outward. She came out of the smoke already fighting, and didn't stop until a dozen guards lay dead in corridors that had, an hour before, held nothing more dangerous than card games. She took something with her from a dusty alcove near the cells — something that glowed faintly blue — though no one in the party saw her take it, and no one yet knows it's gone.",
    locationId: tunnels,
    nextStep: "Her reappearance, or a Watch report noting a missing item, would bring this thread back to the surface.",
    revealed: true,
    characterIds: [],
  });

  await adminUpsertStoryline(LEGACY_CAMPAIGN_ID, {
    title: "The Goliath, Loose",
    status: "Dormant",
    priority: "Low",
    summary: "A caged Goliath prisoner, freed by Kaelomi during the dungeon raid, vanished into the chaos of that night.",
    description:
      "Kaelomi looked at the chained Goliath and saw a kindred thing — caged, perhaps unjustly, perhaps simply caged, which felt reason enough. He broke the chain. What came out was not gratitude, but nine feet of fury that had been waiting a long time to be let loose. What became of him afterward is unknown.",
    locationId: tunnels,
    nextStep: "His fate — recurring ally, recurring threat, or a closed door — hasn't surfaced yet.",
    revealed: true,
    characterIds: [kaelomi],
  });

  await adminUpsertStoryline(LEGACY_CAMPAIGN_ID, {
    title: "The Stolen Antican Scroll",
    status: "Active",
    priority: "Medium",
    summary: "Anika still carries the Old Antican scroll she stole from the Church of Wyr's archive — and it needs a translator.",
    description:
      "The scroll cost Anika her home at the Monastery of Krevan and possibly Father Peregrin's life. Whatever it says, it was important enough for Antican knights to burn a monastery retrieving a copy of it. It remains untranslated, written in a language that predates the current Antican kingdom.",
    locationId: undefined,
    nextStep: "Mollin's Tower of Verantum, or a trustworthy Antican contact, are the most likely paths to a translation.",
    revealed: true,
    characterIds: [anika],
  });

  await adminUpsertStoryline(LEGACY_CAMPAIGN_ID, {
    title: "The Salvatore Inheritance",
    status: "Background",
    priority: "Low",
    summary: "Three Salvatore heirs believed dead are, in fact, alive — and the uncle who inherited their family's seat doesn't know it yet.",
    description:
      "Julian, Anika, and Noah all survived the fire that was meant to kill them, scattered and unaware of each other for most of their lives. Their uncle Maximus has held the family's seat on Vyrene's Accord ever since, and the Accord considers the matter long settled. Whether the siblings ever contest that is entirely undecided.",
    locationId: undefined,
    nextStep: "A direct challenge, a quiet reclaiming, or simply walking away are all still on the table.",
    revealed: true,
    characterIds: [anika, noah, julian, maximus],
  });

  // ---- Timeline ----------------------------------------------------------
  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Convergence of Lights",
    description:
      "The party arrives in Camor during the great festival, settles at the Crawling Toad in Pilgrim's Row, and meets Aldric — a halfling merchant whose wife Sera has been imprisoned on false charges. A confrontation with Captain Marrek leaves the party with their first enemy in the city.",
    inWorldDate: "Festival, Day -1 to Day 1",
    sortIndex: 1,
    sessionNumber: 1,
    eventType: "Session",
    locationId: location.camor,
    revealed: true,
    characterIds: [anika, noah, kaelomi, turi, aldric],
  });

  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Opening of the Maw",
    description:
      "The harbor opens for the festival. Micah rejoins the party at the Harborfoot, meeting Kaelomi, Turi, and Henryhan for the first time. Kaelomi, Henryhan, and Noah sign up for the tournament arenas, while Anika notices a brown-robed cleric moving through the crowd with a strange, deliberate pattern.",
    inWorldDate: "Festival, Day 1",
    sortIndex: 2,
    sessionNumber: 2,
    eventType: "Session",
    locationId: harborfoot,
    revealed: true,
    characterIds: [anika, noah, kaelomi, turi, micah],
  });

  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Void That Heals",
    description:
      "Kaelomi, Henryhan, and Noah win their arena bouts. Anika follows the brown-robed cleric — Brother Ossian — to the medical tent and witnesses his healing draw pain out rather than restore it. The party confronts him directly; he explains, calmly, that his church is preparing for something pressing against the world's boundary.",
    inWorldDate: "Festival, Day 1",
    sortIndex: 3,
    sessionNumber: 3,
    eventType: "Session",
    locationId: location.camor,
    revealed: true,
    characterIds: [anika, kaelomi, turi, ossian],
  });

  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Harborfoot",
    description:
      "The party splits to cover more ground — Anika and Noah investigate the growing refugee population at the Harborfoot, while the others chase leads in the upper city. They meet several refugees from the Mollin border crisis, and a young Vorryn cleric named Father Kaes working among them. The party reunites and agrees not to split up again.",
    inWorldDate: "Festival, Day 1-2",
    sortIndex: 4,
    sessionNumber: 4,
    eventType: "Session",
    locationId: harborfoot,
    revealed: true,
    characterIds: [anika, noah, kaelomi, turi],
  });

  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Dungeon Raid",
    description:
      "The party descends into Camor's dungeon to free Sera. The rescue goes catastrophic: a caged Drow prisoner's cell explodes and she escapes through the chaos, Kaelomi frees a chained Goliath who vanishes into the tunnels, and the party escapes through a hidden tunnel network to the Harborfoot docks at dawn — with Sera alive, but the cost far higher than anyone expected.",
    inWorldDate: "Festival, Day 2, night",
    sortIndex: 5,
    sessionNumber: 5,
    eventType: "Session",
    locationId: tunnels,
    revealed: true,
    characterIds: [anika, noah, kaelomi, turi, sera],
  });

  await adminUpsertTimelineEvent(LEGACY_CAMPAIGN_ID, {
    title: "The Obsidian Sanctum",
    description:
      "Rather than surface into the city, the exhausted party shelters at an ancient obsidian temple on Camor's outskirts — led there by Sera, who believed it was safe. It was not empty. The party fought through three waves of undead guardians, defeated a mysterious ashen priest, and looted a strange, hungry gemstone from the ashes: the Wildheart Core.",
    inWorldDate: "Festival, Day 2-3, night",
    sortIndex: 6,
    sessionNumber: 6,
    eventType: "Session",
    locationId: obsidianSanctum,
    revealed: true,
    characterIds: [anika, noah, kaelomi, turi, sera],
  });

  // ---- Character <-> Faction links ----------------------------------------
  await linkCharacterFaction(anika, houseSalvatore, "Surviving heir (in exile)");
  await linkCharacterFaction(noah, houseSalvatore, "Surviving heir (in exile)");
  await linkCharacterFaction(noah, orderOfVorryn, "Raised and trained by the Order");
  await linkCharacterFaction(julian, houseSalvatore, "Surviving heir");
  await linkCharacterFaction(maximus, houseSalvatore, "Current Weapons Guild seat holder");
  await linkCharacterFaction(maximus, accord, "Weapons Guild master");
  await linkCharacterFaction(raynar, orderOfVorryn, "Master-at-Arms");
  await linkCharacterFaction(ossian, sleepingHand, "Recruiter");

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
