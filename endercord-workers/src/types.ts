export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}

// ── DB row types ───────────────────────────────────────────────────────

export interface Server {
  id: number;
  host: string;          // the hostname the operator connected with at setup, or the IP
  plugin_url: string;
  secret: string;
  mc_port: number;       // Minecraft game port (for /serverinfo ping); default 25565
  added_at: number;
}

export interface UserServer extends Server {
  is_default: number;
}

export interface RegisteredUser {
  discord_id: string;
  username: string;
  allow_ops: number;
  registered_at: number;
}

export interface ChannelSettings {
  channel_id: string;
  server_id: number;
  join_notif: string;
  leave_notif: string;
  pingguard_notif: string;
}

// ── Discord types ──────────────────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface DiscordInteraction {
  id: string;
  type: number;
  data?: InteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: { user: DiscordUser; permissions?: string };
  user?: DiscordUser;
  token: string;
  message?: { components?: ActionRow[] };
}

export interface InteractionData {
  name: string;
  type?: number;          // 1=CHAT_INPUT, 2=USER, 3=MESSAGE (context menu)
  target_id?: string;     // for context-menu commands: the targeted message/user id
  resolved?: {
    messages?: Record<string, ResolvedMessage>;
  };
  options?: InteractionOption[];
  custom_id?: string;
  values?: string[];
}

export interface ResolvedMessage {
  id: string;
  author?: { id: string; username?: string; global_name?: string | null };
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  thumbnail?: { url: string };
  image?: { url: string };
}

export interface ActionRow {
  type: 1;
  components: SelectMenuComponent[];
}

export interface SelectMenuComponent {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: SelectOption[];
}

export interface SelectOption {
  label: string;
  value: string;
  default?: boolean;
}

// ── Plugin response types ──────────────────────────────────────────────

export interface PluginTps {
  tps_1m: number;
  tps_5m: number;
  tps_15m: number;
}

export interface PluginPlayers {
  online: number;
  max: number;
  players: string[];
}

export interface Item { id: string; count: number }
export interface SlotItem { slot: number; item: Item }

export interface PluginPlayer {
  name: string;
  online: boolean;
  health: number;
  max_health: number;
  food: number;
  xp_level: number;
  xp_progress: number;
  gamemode: string;
  location?: { world: string; x: number; y: number; z: number };
  inventory?: {
    armor: { helmet?: Item; chestplate?: Item; leggings?: Item; boots?: Item };
    hotbar: SlotItem[];
    main: SlotItem[];
    offhand?: Item;
  };
  ender_chest?: SlotItem[];
  last_seen?: number;
}

export interface PluginSession {
  joined_at: number;
  left_at?: number;
}

// Carries the raw Discord request data through to plugin calls for signature passthrough
export interface RequestCtx {
  rawBody: string;
  signature: string;
  timestamp: string;
}
