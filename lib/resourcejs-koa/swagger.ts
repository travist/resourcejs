import { parse } from 'path-to-regexp'
import { type Schema } from 'mongoose'
import { type Resource } from './resource.js'
import { type OpenAPIV3 } from 'openapi-types'
import { type OpenAPIDoc, type MongooseSchemaType, type TempSchemas } from './types.js'

const fixNestedRoutes = function (resource: Resource): Resource {
  const routeParts = resource.route.split('/')
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].charAt(0) === ':') {
      routeParts[i] = `{${routeParts[i].slice(1)}}`
    }
  }
  resource.routeFixed = routeParts.join('/')
  return resource
}

const addNestedIdParameter = function (resource: Resource, parameters: OpenAPIV3.ParameterObject[]): void {
  const route = resource?.route ?? ''
  const params = parse(route)
  if (params.length > 0) {
    let primaryModel = ''
    for (const param of params) {
      if (typeof param === 'string') {
        primaryModel = param.match(/(?:([^/]+?))$/)?.[1] ?? ''
        continue
      } else {
        parameters.push({
          in: 'path',
          name: param.name.toString(),
          description: `The parent model of ${resource.modelName}: ${primaryModel}`,
          required: true,
          schema: {
            type: 'string'
          }
        })
      }
    }
  }
}

const setProperty = (property: (TempSchemas & OpenAPIV3.SchemaObject), path: MongooseSchemaType, name: string): void => {
  if (path.options.description != null) {
    property.description = path.options.description
  }

  // Add the example if they provided it.
  if (path.options.example != null) {
    property.example = path.options.example
  }

  // Set enum values if applicable
  if (path.enumValues != null && path.enumValues.length > 0) {
    property.enum = path.enumValues
  }

  if (!isNaN(path.options.min)) {
    property.minimum = path.options.min
  }

  if (!isNaN(path.options.max)) {
    property.maximum = path.options.max
  }
}

/**
 * Converts a Mongoose property to a Swagger property.
 *
 * @param {MongooseSchemaType} path Mongoose schema type to be converted
 * @param {string} name Name of the OpenAPI component schema
 * @returns OpenAPI Schema or reference object. If a nested Mongoose Schema, returns those too.
 */
const getProperty = function (path: MongooseSchemaType, name: string): TempSchemas & OpenAPIV3.ReferenceObject | TempSchemas & OpenAPIV3.SchemaObject | undefined {
  let options = path.options as Record<string, any>

  // Convert to the proper format if needed.
  if (!Object.hasOwn(options, 'type')) options = { type: options }

  // If no type, then return.
  if (options.type == null) {
    return
  }

  // If this is an array, then return the array with items.
  if (Array.isArray(options.type)) {
    if (Object.hasOwn(options.type[0], 'paths')) {
      return {
        type: 'array',
        title: name,
        items: {
          $ref: `#/components/schemas/${name}`
        },
        schemas: getModel(options.type[0], name)
      }
    }
    return {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  }
  // For embedded schemas:
  if (options.type.constructor.name === 'Schema') {
    if (Object.hasOwn(options.type, 'paths')) {
      return {
        $ref: `#/components/schemas/${name}`,
        schemas: getModel(options.type, name)
      }
    }
  }
  if (typeof options.type === 'function') {
    let functionName = options.type.toString()
    functionName = functionName.substr('function '.length)
    functionName = functionName.substr(0, functionName.indexOf('('))

    switch (functionName) {
      case 'ObjectId':
        return {
          type: 'string',
          description: 'ObjectId'
        }
      case 'Oid':
        return {
          type: 'string',
          description: 'Oid'
        }
      case 'Array':
        return {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      case 'Mixed':
        return {
          type: 'object'
        }
      case 'Buffer':
        return {
          type: 'string'
        }
    }
  }

  switch (options.type) {
    case 'ObjectId':
      return {
        type: 'string',
        description: 'ObjectId'
      }
    case String:
      return {
        type: 'string'
      }
    case Number:
      return {
        type: 'integer',
        format: 'int64'
      }
    case Date:
      return {
        type: 'string',
        format: 'date'
      }
    case Boolean:
      return {
        type: 'boolean'
      }
    case Function:
      break
    case Object:
      return undefined
  }

  if (options.type instanceof Object) return
  throw new Error(`Unrecognized type: ${options.type as string}`)
}

const getModel = function (schema: Schema, modelName: string): Record<string, OpenAPIV3.SchemaObject> {
  // Define the definition structure.
  let schemas: Record<string, OpenAPIV3.SchemaObject> = {}
  const model: OpenAPIV3.SchemaObject = {
    title: modelName
  }
  // Iterate through each model schema path.
  for (const name in schema.paths) {
    if (Object.hasOwn(schema.paths, name)) {
      const path = schema.paths[name]

      // Set the property for the swagger model.
      const property = getProperty(path, name)
      if (name.substr(0, 2) !== '__' && (property != null)) {
        // Add the description if they provided it.
        if (!Object.hasOwn(property, '$ref') && Object.hasOwn(property, 'type')) {
          setProperty(property, path, name)

          // Add the required params if needed.
          if (path.options.required === true) {
            if (model.required == null) model.required = []
            model.required.push(name)
          }
        }

        if (!Object.hasOwn(property, 'type') &&
          !Object.hasOwn(property, '$ref')) {
          console.log('Warning: That field type is not yet supported in Swagger definitions, using "string"')
          console.log('Path name: %s.%s', modelName, name)
          console.log('Mongoose type: %s', path.options.type);
          (property as (TempSchemas & OpenAPIV3.SchemaObject)).type = 'string'
        }

        // Allow properties to pass back additional schemas.
        if (property.schemas != null) {
          schemas = Object.assign(schemas, property.schemas)
          delete property.schemas
        }

        // Add this property to the definition.
        if (model.properties == null) model.properties = {}
        model.properties[name] = property
      }
    }
  }
  schemas[modelName] = model
  return schemas
}

export default function (resource: Resource): OpenAPIV3.Document {
  resource = fixNestedRoutes(resource)

  // Build and return a Swagger definition for this model.

  const listPath = resource.routeFixed as string
  const bodyDefinitions = getModel(resource.model.schema, resource.modelName)

  const swagger: OpenAPIDoc = {
    info: {
      title: `OpenAPI v3.1 for ${resource.modelName}`,
      version: resource.version ?? '1.0.0'
    },
    components: {
      schemas: {}
    },
    paths: {},
    openapi: '3.1'
  }

  // Build Swagger definitions.
  swagger.components.schemas = Object.assign(swagger.components?.schemas ?? {}, bodyDefinitions)

  // Build Swagger paths
  const methods = resource.methods
  // INDEX and POST listPath
  if (methods.has('index') || methods.has('post')) {
    const path: OpenAPIV3.PathItemObject = {}
    // INDEX of listPath
    if (methods.has('index')) {
      path.get = {
        tags: [resource.name],
        summary: `List multiple ${resource.modelName} resources.`,
        description: `This operation allows you to list and search for ${resource.modelName} resources provided query arguments.`,
        operationId: `get${resource.modelName}s`,
        responses: {
          401: {
            description: 'Unauthorized.'
          },
          200: {
            description: 'Resource(s) found.  Returned as array.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: `#/components/schemas/${resource.modelName}`
                  }
                }
              }
            }
          }
        },
        parameters: [
          {
            name: 'skip',
            in: 'query',
            description: 'How many records to skip when listing. Used for pagination.',
            required: false,
            schema: {
              type: 'integer',
              default: 0
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'How many records to limit the output.',
            required: false,
            schema: {
              type: 'integer',
              default: 10
            }
          },
          // {
          //  name: 'count',
          //  in: 'query',
          //  description: 'Set to true to return the number of records instead of the documents.',
          //  type: 'boolean',
          //  required: false,
          //  default: false
          // },
          {
            name: 'sort',
            in: 'query',
            description: 'Which fields to sort the records on.',
            schema: {
              type: 'string',
              default: ''
            },
            required: false
          },
          {
            name: 'select',
            in: 'query',
            description: 'Select which fields will be returned by the query.',
            schema: {
              type: 'string',
              default: ''
            },
            required: false
          },
          {
            name: 'populate',
            in: 'query',
            description: 'Select which fields will be fully populated with the reference.',
            schema: {
              type: 'string',
              default: ''
            },
            required: false
          }
        ]
      }
      addNestedIdParameter(resource, path.get.parameters as OpenAPIV3.ParameterObject[])
    }

    // POST listPath.
    if (methods.has('post')) {
      path.post = {
        tags: [resource.name],
        summary: `Create a new ${resource.modelName}`,
        description: `Create a new ${resource.modelName}`,
        operationId: `create${resource.modelName}`,
        responses: {
          401: {
            description: 'Unauthorized.  Note that anonymous submissions are *enabled* by default.'
          },
          400: {
            description: 'An error has occured trying to create the resource.'
          },
          201: {
            description: 'The resource has been created.'
          }
        },
        parameters: [
          {
            in: 'body',
            name: 'body',
            description: `Data used to create a new ${resource.modelName}`,
            required: true,
            schema: {
              $ref: `#/components/schemas/${resource.modelName}`
            }
          }
        ]
      }
      addNestedIdParameter(resource, path.post.parameters as OpenAPIV3.ParameterObject[])
    }
    swagger.paths[listPath] = path
  }

  // The resource path for this resource.
  if (methods.has('get') || methods.has('put') || methods.has('delete')) {
    const path: OpenAPIV3.PathItemObject = {}
    // GET path.
    if (methods.has('get')) {
      path.get = {
        tags: [resource.name],
        summary: `Return a specific ${resource.name} instance.`,
        description: `Return a specific ${resource.name} instance.`,
        operationId: `get${resource.modelName}`,
        responses: {
          500: {
            description: 'An error has occurred.'
          },
          404: {
            description: 'Resource not found'
          },
          401: {
            description: 'Unauthorized.'
          },
          200: {
            description: 'Resource found',
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${resource.modelName}`
                }
              }
            }
          }
        },
        parameters: [
          {
            name: `${resource.modelName}Id`,
            in: 'path',
            description: `The ID of the ${resource.name} that will be retrieved.`,
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ]
      }
      addNestedIdParameter(resource, path.get?.parameters as OpenAPIV3.ParameterObject[])
    }

    // PUT path
    if (methods.has('put')) {
      path.put = {
        tags: [resource.name],
        summary: `Update a specific ${resource.name} instance.`,
        description: `Update a specific ${resource.name} instance.`,
        operationId: `update${resource.modelName}`,
        responses: {
          500: {
            description: 'An error has occurred.'
          },
          404: {
            description: 'Resource not found'
          },
          401: {
            description: 'Unauthorized.'
          },
          400: {
            description: 'Resource could not be updated.'
          },
          200: {
            description: 'Resource updated',
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${resource.modelName}`
                }
              }
            }
          }
        },
        parameters: [
          {
            name: `${resource.modelName}Id`,
            in: 'path',
            description: `The ID of the ${resource.name} that will be updated.`,
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          },
          {
            in: 'body',
            name: 'body',
            description: `Data used to update ${resource.modelName}`,
            required: true,
            schema: {
              $ref: `#/components/schemas/${resource.modelName}`
            }
          }
        ]
      }
      addNestedIdParameter(resource, path.put?.parameters as OpenAPIV3.ParameterObject[])
    }

    // DELETE path
    if (methods.has('delete')) {
      path.delete = {
        tags: [resource.name],
        summary: `Delete a specific ${resource.name}`,
        description: `Delete a specific ${resource.name}`,
        operationId: `delete${resource.modelName}`,
        responses: {
          500: {
            description: 'An error has occurred.'
          },
          404: {
            description: 'Resource not found'
          },
          401: {
            description: 'Unauthorized.'
          },
          400: {
            description: 'Resource could not be deleted.'
          },
          204: {
            description: 'Resource was deleted'
          }
        },
        parameters: [
          {
            name: `${resource.modelName}Id`,
            in: 'path',
            description: `The ID of the ${resource.name} that will be deleted.`,
            required: true,
            schema: {
              type: 'string',
              format: 'uuid'
            }
          }
        ]
      }
      addNestedIdParameter(resource, path.delete?.parameters as OpenAPIV3.ParameterObject[])
      swagger.paths[`${listPath}/{${resource.modelName}Id}`] = path
    }
  }

  // VIRTUAL path
  for (const method of methods) {
    if (!/^virtual\//.test(method)) continue
    const path: OpenAPIV3.PathItemObject = {
      get: {
        tags: [resource.name, 'virtual'],
        summary: `Virtual resource for ${resource.name} named ${method.split('/')[1]}`,
        description: `get ${resource.modelName} ${method.split('/')[1]}`,
        operationId: `get ${resource.modelName} ${method.split('/')[1]}`,
        responses: {
          500: {
            description: 'An error has occurred.'
          },
          404: {
            description: 'Resource not found'
          },
          401: {
            description: 'Unauthorized.'
          },
          200: {
            description: 'Resource found'
          }
        }
      }
    }
    swagger.paths[`${listPath}/${method}`] = path
  }
  // Return the swagger definition for this resource.
  return swagger
};
