export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export interface Question {
    content: string;
    options: string[];
    /**
     * Must be one of the entries in the options array
     */
    correctAnswer: string;
    difficulty: Difficulty;
}
export declare const questionSeeds: Question[];
