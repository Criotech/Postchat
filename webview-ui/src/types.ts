export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};
