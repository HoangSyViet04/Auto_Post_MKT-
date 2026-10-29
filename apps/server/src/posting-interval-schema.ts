export const postingIntervalSchema = {
  type: 'object', additionalProperties: false, required: ['minSeconds', 'maxSeconds'], properties: {
    minSeconds: { type: 'integer', minimum: 0, maximum: 86_400 },
    maxSeconds: { type: 'integer', minimum: 0, maximum: 86_400 },
  },
} as const;
