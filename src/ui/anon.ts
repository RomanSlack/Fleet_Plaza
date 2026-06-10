// Anonymous mode: deterministic display aliases so screenshots leak nothing.
// Pure display-layer — real names stay in state, aliases derive from a hash.

const AGENT_ALIASES = [
  "nova", "zephyr", "quartz", "ember", "drift", "lumen", "pixel", "fjord",
  "sable", "onyx", "cedar", "tide", "aspen", "flint", "koda", "wren",
  "slate", "birch", "moss", "rune", "echo", "vale", "frost", "reed",
];

const ZONE_ALIASES = [
  "Apollo", "Vega", "Orion", "Atlas", "Juno", "Iris", "Rigel", "Lyra",
  "Titan", "Sirius", "Comet", "Nimbus", "Zenith", "Aurora", "Quasar", "Pulsar",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function agentAlias(name: string): string {
  const h = hash(name);
  return `${AGENT_ALIASES[h % AGENT_ALIASES.length]}-${((h >> 6) % 90) + 10}`;
}

export function zoneAlias(name: string): string {
  if (name === "Visitors") return name;
  return `Project ${ZONE_ALIASES[hash(name) % ZONE_ALIASES.length]}`;
}
