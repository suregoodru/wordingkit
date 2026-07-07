import {
  Action,
  ActionPanel,
  Form,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import {
  createMode,
  updateMode,
  validateEditingMode,
  type EditingMode,
  type Provider,
} from "./modes";

type FormValues = {
  title: string;
  description: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
};

type ModeFormProps = {
  mode?: EditingMode;
  onSaved: () => Promise<unknown> | unknown;
};

const providerOptions: Array<{ value: Provider; title: string }> = [
  { value: "openai", title: "OpenAI" },
  { value: "anthropic", title: "Anthropic" },
  { value: "groq", title: "Groq" },
  { value: "ollama", title: "Ollama" },
];

export default function ModeForm({ mode, onSaved }: ModeFormProps) {
  const { pop } = useNavigation();

  async function save(values: FormValues) {
    try {
      const validated = validateEditingMode({
        id: mode?.id ?? "new-mode",
        title: values.title,
        description: values.description,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        temperature: Number(values.temperature),
        maxTokens: Number(values.maxTokens),
      });

      if (mode) {
        await updateMode(validated);
      } else {
        await createMode({
          title: validated.title,
          description: validated.description,
          provider: validated.provider,
          model: validated.model,
          systemPrompt: validated.systemPrompt,
          temperature: validated.temperature,
          maxTokens: validated.maxTokens,
        });
      }
      await onSaved();
      await pop();
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Проверьте параметры режима",
        message: String(reason),
      });
    }
  }

  return (
    <Form
      navigationTitle={mode ? "Изменить режим" : "Новый режим"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Сохранить" onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Название" defaultValue={mode?.title} />
      <Form.TextField
        id="description"
        title="Описание"
        defaultValue={mode?.description}
      />
      <Form.Dropdown
        id="provider"
        title="Провайдер"
        defaultValue={mode?.provider ?? "ollama"}
      >
        {providerOptions.map(({ value, title }) => (
          <Form.Dropdown.Item key={value} value={value} title={title} />
        ))}
      </Form.Dropdown>
      <Form.TextField
        id="model"
        title="Модель"
        defaultValue={mode?.model ?? "qwen3:14b"}
      />
      <Form.TextArea
        id="systemPrompt"
        title="Системная инструкция"
        defaultValue={mode?.systemPrompt}
      />
      <Form.TextField
        id="temperature"
        title="Температура"
        defaultValue={String(mode?.temperature ?? 0.2)}
      />
      <Form.TextField
        id="maxTokens"
        title="Максимум токенов"
        defaultValue={String(mode?.maxTokens ?? 4096)}
      />
    </Form>
  );
}
