import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { type Methods } from '../types.js'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

// An object to store handler events.
const handlers: Record<string, any> = {}

let resource: {
  _id: string
  title?: string
  age?: number
  married?: boolean
  updated?: Date
  description?: string
}

let replSet: MongoMemoryReplSet

/**
 * Updates the reference for the handler invocation using the given sequence and method.
 *
 * @param entity
 *   The entity this handler is associated with.
 * @param sequence
 *   The sequence of invocation: `before` or `after`.
 * @param req
 *   The express request to manipulate.
 */
function setInvoked (entity: string, sequence: string, ctx: Koa.Context): void {
  // Get the url fragments, to determine if this request is a get or index.
  const parts = ctx.url.split('/')
  parts.shift() // Remove empty string element.

  let method = ctx.method.toLowerCase()
  if (method === 'get' && (parts.length % 2 === 0)) {
    method = 'index'
  }

  if (!Object.hasOwn(handlers, entity)) {
    handlers[entity] = {}
  }
  if (!Object.hasOwn(handlers[entity], sequence)) {
    handlers[entity][sequence] = {}
  }

  handlers[entity][sequence][method] = true
}

/**
 * Determines if the handler for the sequence and method was invoked.
 *
 * @param entity
 *   The entity this handler is associated with.
 * @param sequence
 *   The sequence of invocation: `before` or `after`.
 * @param method
 *   The HTTP method for the invocation: `post`, `get`, `put`, `delete`, or `patch`
 *
 * @return
 *   If the given handler was invoked or not.
 */
function wasInvoked (entity: string, sequence: string, method: Methods): boolean {
  if (
    Object.hasOwn(handlers, entity) &&
    Object.hasOwn(handlers[entity], sequence) &&
    Object.hasOwn(handlers[entity][sequence], method)
  ) {
    return handlers[entity][sequence][method]
  } else {
    return false
  }
}

test.serial.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members

  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  client.db('test')
})

test.before('Build the /test/resource2 endpoints', async (t) => {
  // Create the schema.
  const Resource2Schema = new mongoose.Schema({
    title: {
      type: String,
      required: true
    },
    age: {
      type: Number
    },
    married: {
      type: Boolean,
      default: false
    },
    updated: {
      type: Number,
      default: null
    },
    description: {
      type: String
    }
  })

  // Create the model.
  const Resource2Model = mongoose.model('resource2', Resource2Schema)

  // Create the REST resource and continue.
  const resource2 = ResourceJS(app, '/test', 'resource2', Resource2Model).rest({
    // Register before/after global handlers.
    async before (ctx: Koa.Context, next: Koa.Next) {
      // Store the invoked handler and continue.
      setInvoked('resource2', 'before', ctx)
      return await next()
    },
    async beforePost (ctx: Koa.Context, next: Koa.Next) {
      // Store the invoked handler and continue.
      setInvoked('resource2', 'beforePost', ctx)
      return await next()
    },
    async after (ctx: Koa.Context, next: Koa.Next) {
      // Store the invoked handler and continue.
      setInvoked('resource2', 'after', ctx)
      return await next()
    },
    async afterPost (ctx: Koa.Context, next: Koa.Next) {
      // Store the invoked handler and continue.
      setInvoked('resource2', 'afterPost', ctx)
      return await next()
    }
  })
  const { default: resource2Swaggerio } = await import('./OpenAPI/resource2.json', {
    assert: { type: 'json' }
  })
  const swaggerio = resource2.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.resource2)
  t.is((swaggerio.components?.schemas?.resource2 as OpenAPIV3.SchemaObject).title, 'resource2')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, resource2Swaggerio)
})

test.serial('Test single resource handlers capabilities: A POST request should invoke the global handlers and method handlers', async (t) => await request(server)
  .post('/test/resource2')
  .send({
    title: 'Test1',
    description: '12345678'
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1')
    t.is(response.description, '12345678')
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')

    // Confirm that the handlers were called.
    t.is(wasInvoked('resource2', 'before', 'post'), true)
    t.is(wasInvoked('resource2', 'after', 'post'), true)
    t.is(wasInvoked('resource2', 'beforePost', 'post'), true)
    t.is(wasInvoked('resource2', 'afterPost', 'post'), true)

    // Store the resource and continue.
    resource = response
  }))

test.serial('Test single resource handlers capabilities: A GET request should invoke the global handlers', async (t) => await request(server)
  .get(`/test/resource2/${resource._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1')
    t.is(response.description, '12345678')
    t.true(Object.hasOwn(response, '_id'), 'Resource ID not found')

    // Confirm that the handlers were called.
    t.is(wasInvoked('resource2', 'before', 'get'), true)
    t.is(wasInvoked('resource2', 'after', 'get'), true)

    // Confirm that POST method handlers were NOT called
    t.is(wasInvoked('resource2', 'beforePost', 'get'), false)
    t.is(wasInvoked('resource2', 'afterPost', 'get'), false)

    // Store the resource and continue.
    resource = response
  }))

test.serial('Test single resource handlers capabilities: Should allow you to use select to select certain fields.', async (t) => await request(server)
  .get(`/test/resource2/${resource._id}?select=title`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1')
    t.is(response.description, undefined)
  }))

test.serial('Test single resource handlers capabilities: A PUT request should invoke the global handlers', async (t) => await request(server)
  .put(`/test/resource2/${resource._id}`)
  .send({
    title: 'Test1 - Updated'
  })
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1 - Updated')
    t.is(response.description, '12345678')
    t.true(Object.hasOwn(response, '_id'), 'Resource ID not found')

    // Confirm that the handlers were called.
    t.is(wasInvoked('resource2', 'before', 'put'), true)
    t.is(wasInvoked('resource2', 'after', 'put'), true)

    // Store the resource and continue.
    resource = response
  }))

test.serial('Test single resource handlers capabilities: A GET (Index) request should invoke the global handlers', async (t) => await request(server)
  .get('/test/resource2')
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'Test1 - Updated')
    t.is(response[0].description, '12345678')
    t.true(Object.hasOwn(response[0], '_id'), 'Resource ID not found')

    // Confirm that the handlers were called.
    t.is(wasInvoked('resource2', 'before', 'index'), true)
    t.is(wasInvoked('resource2', 'after', 'index'), true)

    // Store the resource and continue.
    resource = response[0]
  }))

test.serial('Test single resource handlers capabilities: A DELETE request should invoke the global handlers', async (t) => await request(server)
  .delete(`/test/resource2/${resource._id}`)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.deepEqual(response, {})

    // Confirm that the handlers were called.
    t.is(wasInvoked('resource2', 'before', 'delete'), true)
    t.is(wasInvoked('resource2', 'after', 'delete'), true)

    // Store the resource and continue.
    resource = response
  }))

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
