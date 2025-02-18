import type {
  ComponentsObject,
  MediaTypeObject,
  OASDocument,
  ResponseObject,
  SchemaObject,
  HeaderObject,
} from 'rmoas.types';
import type Operation from 'operation';
import toJSONSchema from '../lib/openapi-to-json-schema';
import matches from '../lib/matches-mimetype';

const isJSON = matches.json;

/**
 * Turn a header map from OpenAPI 3.0.3 (and some earlier versions too) into a schema.
 *
 * Note: This does not support OpenAPI 3.1.0's header format.
 *
 * @see {@link https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.0.3.md#headerObject}
 * @see {@link https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.3.md#headerObject}
 * @param response Response object to build a JSON Schema object for its headers for.
 */
function buildHeadersSchema(response: ResponseObject) {
  const headers = response.headers;

  const headersSchema: SchemaObject = {
    type: 'object',
    properties: {},
  };

  Object.keys(headers).forEach(key => {
    if (headers[key] && (headers[key] as HeaderObject).schema) {
      const header: HeaderObject = headers[key] as HeaderObject;

      // TODO: Response headers are essentially parameters in OAS
      //    This means they can have content instead of schema.
      //    We should probably support that in the future
      headersSchema.properties[key] = toJSONSchema(header.schema);

      if (header.description) {
        (headersSchema.properties[key] as HeaderObject).description = header.description;
      }
    }
  });

  const headersWrapper: {
    schema: SchemaObject;
    type: string;
    label: string;
    description?: string;
  } = {
    schema: headersSchema,
    type: 'object',
    label: 'Headers',
  };

  if (response.description && headersWrapper.schema) {
    headersWrapper.description = response.description;
  }

  return headersWrapper;
}

/**
 * Extract all the response schemas, matching the format of get-parameters-as-json-schema.
 *
 * Note: This expects a dereferenced schema.
 *
 * @param operation Operation to construct a response JSON Schema for.
 * @param api The OpenAPI definition that this operation originates.
 * @param statusCode The response status code to generate a schema for.
 */
export default function getResponseAsJsonSchema(operation: Operation, api: OASDocument, statusCode: string | number) {
  const response = operation.getResponseByStatusCode(statusCode);
  const jsonSchema = [];

  if (!response) {
    return null;
  }

  let hasCircularRefs = false;

  function refLogger() {
    hasCircularRefs = true;
  }

  /**
   * @param content An array of `MediaTypeObject`'s to retrieve a preferred schema out of. We prefer JSON media types.
   */
  function getPreferredSchema(content: Record<string, MediaTypeObject>) {
    if (!content) {
      return null;
    }

    const contentTypes = Object.keys(content);
    if (!contentTypes.length) {
      return null;
    }

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < contentTypes.length; i++) {
      if (isJSON(contentTypes[i])) {
        return toJSONSchema(content[contentTypes[i]].schema, { refLogger });
      }
    }

    // We always want to prefer the JSON-compatible content types over everything else but if we haven't found one we
    // should default to the first available.
    const contentType = contentTypes.shift();
    return toJSONSchema(content[contentType].schema, { refLogger });
  }

  const foundSchema = getPreferredSchema((response as ResponseObject).content);
  if (foundSchema) {
    const schemaWrapper: {
      type: string | string[];
      schema: SchemaObject;
      label: string;
      description?: string;
    } = {
      // If there's no `type` then the root schema is a circular `$ref` that we likely won't be able to render so
      // instead of generating a JSON Schema with an `undefined` type we should default to `string` so there's at least
      // *something* the end-user can interact with.
      type: foundSchema.type || 'string',
      schema: JSON.parse(JSON.stringify(foundSchema)),
      label: 'Response body',
    };

    if ((response as ResponseObject).description && schemaWrapper.schema) {
      schemaWrapper.description = (response as ResponseObject).description;
    }

    // Since this library assumes that the schema has already been dereferenced, adding every component here that
    // **isn't** circular adds a ton of bloat so it'd be cool if `components` was just the remaining `$ref` pointers
    // that are still being referenced.
    // @todo
    if (hasCircularRefs && api.components && schemaWrapper.schema) {
      ((schemaWrapper.schema as SchemaObject).components as ComponentsObject) = api.components as ComponentsObject;
    }

    jsonSchema.push(schemaWrapper);
  }

  // 3.0.3 and earlier headers. TODO: New format for 3.1.0
  if ((response as ResponseObject).headers) {
    jsonSchema.push(buildHeadersSchema(response as ResponseObject));
  }

  return jsonSchema.length ? jsonSchema : null;
}
