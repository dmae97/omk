import { z } from "zod";
import { OMK_ERROR_CODES } from "../contracts/errors.js";

export const OmkErrorSchema = z.object({
  code: z.enum(OMK_ERROR_CODES),
  message: z.string().min(1),
  recoverable: z.boolean(),
  severity: z.enum(["info", "warning", "error", "fatal"]),
  hint: z.string().optional(),
  cause: z.string().optional(),
  path: z.string().optional(),
});

export const OmkWarningSchema = OmkErrorSchema;
