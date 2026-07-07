import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  deleteMode,
  loadModeSettings,
  moveMode,
  resetModes,
  setSortMode,
  type EditingMode,
} from "./modes";
import ModeForm from "./mode-form";

type SortMode = "custom" | "last-used";

export default function Settings() {
  const [modes, setModes] = useState<EditingMode[]>([]);
  const [sortMode, setSelectedSortMode] = useState<SortMode>("custom");
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);

  async function reloadModes() {
    setIsLoading(true);
    try {
      const settings = await loadModeSettings();
      setModes(settings.modes);
      setSelectedSortMode(settings.sortMode);
      setError(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsLoading(false);
    }
  }

  async function changeSortMode(nextSortMode: SortMode) {
    try {
      await setSortMode(nextSortMode);
      await reloadModes();
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Не удалось изменить порядок",
        message: String(reason),
      });
    }
  }

  async function moveModeBy(id: string, direction: "up" | "down") {
    try {
      await moveMode(id, direction);
      await reloadModes();
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Не удалось переместить режим",
        message: String(reason),
      });
    }
  }

  useEffect(() => {
    void reloadModes();
  }, []);

  async function removeMode(mode: EditingMode) {
    const confirmed = await confirmAlert({
      title: "Удалить режим?",
      message: `Режим «${mode.title}» будет удалён без возможности восстановления.`,
      primaryAction: { title: "Удалить", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    try {
      await deleteMode(mode.id);
      await reloadModes();
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Не удалось удалить режим",
        message: String(reason),
      });
    }
  }

  async function resetCorruptedModes() {
    const confirmed = await confirmAlert({
      title: "Сбросить режимы?",
      message: "Повреждённые сохранённые режимы будут заменены стандартными.",
      primaryAction: {
        title: "Сбросить",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    try {
      await resetModes();
      await reloadModes();
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Не удалось сбросить режимы",
        message: String(reason),
      });
    }
  }

  const createAction = (
    <Action.Push
      title="Создать Режим"
      icon={Icon.Plus}
      target={<ModeForm onSaved={reloadModes} />}
    />
  );

  const sortAction = (
    <ActionPanel.Submenu
      title="Порядок в Rewrite This"
      icon={Icon.Bars3BottomLeft}
    >
      <Action
        title="Пользовательский порядок"
        icon={sortMode === "custom" ? Icon.Check : undefined}
        onAction={() => changeSortMode("custom")}
      />
      <Action
        title="По последнему использованию"
        icon={sortMode === "last-used" ? Icon.Check : undefined}
        onAction={() => changeSortMode("last-used")}
      />
    </ActionPanel.Submenu>
  );

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Не удалось загрузить режимы"
          description={String(error)}
          actions={
            <ActionPanel>
              <Action
                title="Сбросить Режимы"
                icon={Icon.ArrowClockwise}
                style={Action.Style.Destructive}
                onAction={resetCorruptedModes}
              />
              {createAction}
              <Action
                title="Открыть Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} navigationTitle="Режимы редактирования">
      {modes.map((mode, index) => (
        <List.Item
          key={mode.id}
          icon={Icon.Text}
          title={mode.title}
          subtitle={mode.description}
          accessories={[{ text: mode.provider }, { text: mode.model }]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Изменить Режим"
                icon={Icon.Pencil}
                target={<ModeForm mode={mode} onSaved={reloadModes} />}
              />
              {createAction}
              {sortAction}
              {index > 0 ? (
                <Action
                  title="Переместить выше"
                  icon={Icon.ArrowUp}
                  onAction={() => moveModeBy(mode.id, "up")}
                />
              ) : null}
              {index < modes.length - 1 ? (
                <Action
                  title="Переместить ниже"
                  icon={Icon.ArrowDown}
                  onAction={() => moveModeBy(mode.id, "down")}
                />
              ) : null}
              <Action
                title="Удалить Режим"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => removeMode(mode)}
              />
              <Action
                title="Открыть Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && modes.length === 0 ? (
        <List.EmptyView
          icon={Icon.Text}
          title="Нет режимов"
          description="Создайте режим, чтобы переписывать выделенный текст."
          actions={
            <ActionPanel>
              {createAction}
              {sortAction}
              <Action
                title="Открыть Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
