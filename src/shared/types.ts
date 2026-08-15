export type Milestone = {
  t: string;
  c: number;
};

export type Game = {
  id: string;
  name: string;
  prompt: string;
  summary: string;
  miles: Milestone[];
  done: number;
  pool: number;
  spent: number;
  creator: string;
  at: number;
};

export type Version = {
  n: number;
  code: string;
  at: number;
  by: string;
};

export type GameBundle = {
  game: Game;
  versions: Version[];
};

export type StreamEvent =
  | { type: "stream"; text: string }
  | { type: "say"; text: string }
  | { type: "complete"; game: Game; version?: Version }
  | { type: "error"; message: string };
