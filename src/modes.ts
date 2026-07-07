import { LocalStorage } from "@raycast/api";
import { RUSSIAN_STYLES, TONE_PROMPTS } from "./tones.ts";

export type Provider = "openai" | "anthropic" | "groq" | "ollama";

export type EditingMode = {
  id: string;
  title: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  lastUsedAt?: string;
};

export const MODE_STORAGE_KEY = "editing-modes";
export const MODE_STORAGE_VERSION = 2;

export type SortMode = "custom" | "last-used";
export type MoveDirection = "up" | "down";
export type ModeSettings = {
  sortMode: SortMode;
  modes: EditingMode[];
};

const DEFAULT_PROVIDER: Provider = "ollama";
const DEFAULT_MODEL = "qwen3:14b";
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const PROVIDERS: ReadonlySet<Provider> = new Set<Provider>([
  "openai",
  "anthropic",
  "groq",
  "ollama",
]);
const DAMAGED_STORAGE_MESSAGE =
  "Сохранённые режимы повреждены. Измените их в настройках.";

type StoredModeDocument = ModeSettings & {
  version: typeof MODE_STORAGE_VERSION;
};

type LegacyStoredModeDocument = {
  version: 1;
  modes: EditingMode[];
};

let mutationQueue = Promise.resolve();

function queueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function generateModeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultModes(): EditingMode[] {
  return RUSSIAN_STYLES.map(({ id, title, subtitle }) => ({
    id: generateModeId(),
    title,
    description: subtitle,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    systemPrompt: TONE_PROMPTS[id],
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
  }));
}

function isEditingModeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && PROVIDERS.has(value as Provider);
}

function isSortMode(value: unknown): value is SortMode {
  return value === "custom" || value === "last-used";
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export function validateEditingMode(value: unknown): EditingMode {
  if (!isEditingModeRecord(value)) {
    throw new Error("Данные режима должны быть объектом.");
  }

  const {
    id,
    title,
    description,
    provider,
    model,
    systemPrompt,
    temperature,
    maxTokens,
    lastUsedAt,
  } = value;

  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Укажите идентификатор режима.");
  }
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Укажите название режима.");
  }
  if (description !== undefined && typeof description !== "string") {
    throw new Error("Описание режима должно быть текстом.");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("Укажите модель.");
  }
  if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
    throw new Error("Укажите инструкцию для режима.");
  }
  if (!isProvider(provider)) {
    throw new Error("Выберите поддерживаемого провайдера.");
  }
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    throw new Error("Температура должна быть числом от 0 до 2.");
  }
  if (
    typeof maxTokens !== "number" ||
    !Number.isInteger(maxTokens) ||
    maxTokens <= 0
  ) {
    throw new Error("Лимит токенов должен быть положительным целым числом.");
  }
  if (
    lastUsedAt !== undefined &&
    (typeof lastUsedAt !== "string" || !isIsoTimestamp(lastUsedAt))
  ) {
    throw new Error("Дата последнего использования должна быть ISO-датой.");
  }

  return {
    id: id.trim(),
    title: title.trim(),
    ...(description === undefined ? {} : { description: description.trim() }),
    provider,
    model: model.trim(),
    systemPrompt: systemPrompt.trim(),
    temperature,
    maxTokens,
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  };
}

function damagedStorageError(): Error {
  return new Error(DAMAGED_STORAGE_MESSAGE);
}

function validateStoredModeDocument(value: unknown): StoredModeDocument {
  try {
    if (
      !isEditingModeRecord(value) ||
      value.version !== MODE_STORAGE_VERSION ||
      !isSortMode(value.sortMode)
    ) {
      throw damagedStorageError();
    }
    if (!Array.isArray(value.modes)) {
      throw damagedStorageError();
    }

    return {
      version: MODE_STORAGE_VERSION,
      sortMode: value.sortMode,
      modes: value.modes.map(validateEditingMode),
    };
  } catch {
    throw damagedStorageError();
  }
}

function validateLegacyStoredModeDocument(
  value: unknown,
): LegacyStoredModeDocument {
  try {
    if (
      !isEditingModeRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.modes)
    ) {
      throw damagedStorageError();
    }

    return {
      version: 1,
      modes: value.modes.map(validateEditingMode),
    };
  } catch {
    throw damagedStorageError();
  }
}

function validateSortMode(value: unknown): SortMode {
  if (!isSortMode(value)) {
    throw new Error("Выберите поддерживаемый порядок сортировки.");
  }
  return value;
}

async function persistModeSettings(
  settings: ModeSettings,
): Promise<ModeSettings> {
  const document = validateStoredModeDocument({
    version: MODE_STORAGE_VERSION,
    ...settings,
  });
  await LocalStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(document));
  return { sortMode: document.sortMode, modes: document.modes };
}

async function loadModeSettingsUnlocked(): Promise<ModeSettings> {
  const stored = await LocalStorage.getItem(MODE_STORAGE_KEY);
  if (stored === null || stored === undefined) {
    return persistModeSettings({
      sortMode: "custom",
      modes: createDefaultModes(),
    });
  }

  if (typeof stored !== "string") {
    throw damagedStorageError();
  }

  try {
    const parsed = JSON.parse(stored);
    if (isEditingModeRecord(parsed) && parsed.version === 1) {
      const legacyDocument = validateLegacyStoredModeDocument(parsed);
      return persistModeSettings({
        sortMode: "custom",
        modes: legacyDocument.modes,
      });
    }
    const document = validateStoredModeDocument(parsed);
    return { sortMode: document.sortMode, modes: document.modes };
  } catch {
    throw damagedStorageError();
  }
}

export async function loadModeSettings(): Promise<ModeSettings> {
  return queueMutation(loadModeSettingsUnlocked);
}

export async function loadModes(): Promise<EditingMode[]> {
  return (await loadModeSettings()).modes;
}

export async function resetModes(): Promise<EditingMode[]> {
  return queueMutation(async () => {
    const settings = await persistModeSettings({
      sortMode: "custom",
      modes: createDefaultModes(),
    });
    return settings.modes;
  });
}

export async function createMode(
  input: Omit<EditingMode, "id">,
): Promise<EditingMode> {
  return queueMutation(async () => {
    const mode = validateEditingMode({ ...input, id: generateModeId() });
    const settings = await loadModeSettingsUnlocked();
    await persistModeSettings({
      ...settings,
      modes: [...settings.modes, mode],
    });
    return mode;
  });
}

export async function updateMode(mode: EditingMode): Promise<EditingMode> {
  return queueMutation(async () => {
    const validated = validateEditingMode(mode);
    const settings = await loadModeSettingsUnlocked();
    const index = settings.modes.findIndex(({ id }) => id === validated.id);
    if (index === -1) {
      throw new Error("Режим не найден.");
    }
    const updated = validateEditingMode({
      ...validated,
      lastUsedAt: settings.modes[index]?.lastUsedAt,
    });

    await persistModeSettings({
      ...settings,
      modes: [
        ...settings.modes.slice(0, index),
        updated,
        ...settings.modes.slice(index + 1),
      ],
    });
    return updated;
  });
}

export async function deleteMode(id: string): Promise<void> {
  return queueMutation(async () => {
    const settings = await loadModeSettingsUnlocked();
    await persistModeSettings({
      ...settings,
      modes: settings.modes.filter((mode) => mode.id !== id),
    });
  });
}

export async function setSortMode(sortMode: SortMode): Promise<ModeSettings> {
  return queueMutation(async () => {
    const settings = await loadModeSettingsUnlocked();
    return persistModeSettings({
      ...settings,
      sortMode: validateSortMode(sortMode),
    });
  });
}

export async function moveMode(
  id: string,
  direction: MoveDirection,
): Promise<EditingMode[]> {
  return queueMutation(async () => {
    const settings = await loadModeSettingsUnlocked();
    const index = settings.modes.findIndex((mode) => mode.id === id);
    if (index === -1) {
      throw new Error("Режим не найден.");
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= settings.modes.length) {
      return settings.modes;
    }

    const modes = [...settings.modes];
    [modes[index], modes[targetIndex]] = [modes[targetIndex]!, modes[index]!];
    const updated = await persistModeSettings({ ...settings, modes });
    return updated.modes;
  });
}

export async function markModeUsed(
  id: string,
  lastUsedAt: string,
): Promise<EditingMode> {
  return queueMutation(async () => {
    const settings = await loadModeSettingsUnlocked();
    const index = settings.modes.findIndex((mode) => mode.id === id);
    if (index === -1) {
      throw new Error("Режим не найден.");
    }

    const updated = validateEditingMode({
      ...settings.modes[index],
      lastUsedAt,
    });
    await persistModeSettings({
      ...settings,
      modes: [
        ...settings.modes.slice(0, index),
        updated,
        ...settings.modes.slice(index + 1),
      ],
    });
    return updated;
  });
}

export function sortModes(
  modes: EditingMode[],
  sortMode: SortMode,
): EditingMode[] {
  if (sortMode === "custom") {
    return modes;
  }

  return modes
    .map((mode, index) => ({ mode, index }))
    .sort(
      (
        { mode: left, index: leftIndex },
        { mode: right, index: rightIndex },
      ) => {
        if (!left.lastUsedAt)
          return right.lastUsedAt ? 1 : leftIndex - rightIndex;
        if (!right.lastUsedAt) return -1;
        return (
          Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) ||
          leftIndex - rightIndex
        );
      },
    )
    .map(({ mode }) => mode);
}
