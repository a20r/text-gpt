export type Command = 'START' | 'STOP' | 'NEW' | 'HELP' | null;

export function parseCommand(body: string): Command {
  const trimmed = body.trim();
  if (!trimmed) return 'HELP';
  if (/^\/?new$/i.test(trimmed)) return 'NEW';
  if (/^STOP$/i.test(trimmed)) return 'STOP';
  if (/^START$/i.test(trimmed)) return 'START';
  return null;
}
