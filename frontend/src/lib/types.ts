/** Mirrors the Pydantic schemas in backend/app/schemas. */

export type Question =
  | {
      id: string;
      type: 'multiple_choice';
      prompt: string;
      options: string[];
      allow_multiple: boolean;
    }
  | {
      id: string;
      type: 'scale';
      prompt: string;
      min: number;
      max: number;
      min_label?: string | null;
      max_label?: string | null;
    }
  | {
      id: string;
      type: 'short_text';
      prompt: string;
      max_length?: number | null;
    };

export interface Questionnaire {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  schema: Question[];
  analysis_guide: string;
  public_slug: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** The public projection: no `analysis_guide`, by design. */
export interface PublicQuestionnaire {
  id: string;
  title: string;
  description: string | null;
  schema: Question[];
  public_slug: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
