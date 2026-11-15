import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

/** Figures written by pipeline/10_method_figures.py into public/methods/ (static, same origin). */
const FigureSchema = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  caption_simple: z.string(),
  caption_expert: z.string(),
  badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
  source: z.string(),
  group: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type MethodFigure = z.infer<typeof FigureSchema>;

const BASE = `${import.meta.env.BASE_URL}methods/`;
export const figureUrl = (f: MethodFigure) => `${BASE}${f.file}`;

export function useMethodFigures() {
  return useQuery({
    queryKey: ['method-figures'],
    queryFn: async () => {
      const r = await fetch(`${BASE}figures.json`);
      if (!r.ok) throw new Error(`figures.json ${r.status}`);
      const list = z.array(FigureSchema).parse(await r.json());
      return new Map(list.map((f) => [f.id, f]));
    },
    staleTime: Infinity,
  });
}
