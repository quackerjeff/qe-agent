import { z } from "zod";

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertType(schema);
}

function convertType(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    return convertObject(schema);
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: convertType((schema as z.ZodArray<z.ZodType>)._def.type),
    };
  }
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: [...(schema as z.ZodEnum<[string, ...string[]]>)._def.values],
    };
  }
  if (schema instanceof z.ZodOptional) {
    return convertType((schema as z.ZodOptional<z.ZodType>)._def.innerType);
  }
  if (schema instanceof z.ZodDefault) {
    return convertType((schema as z.ZodDefault<z.ZodType>)._def.innerType);
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object" };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return {};
  }
  return {};
}

function convertObject(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const field = fieldSchema as z.ZodType;

    if (field instanceof z.ZodOptional) {
      properties[key] = convertType(
        (field as z.ZodOptional<z.ZodType>)._def.innerType,
      );
    } else {
      properties[key] = convertType(field);
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}
