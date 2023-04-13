import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

let resource: {
  _id: string
  title?: string
  age?: number
  married?: boolean
  updated?: Date
  description?: string
}

let nested: {
  _id: string
  resource2?: string
  title?: string
  age?: number
  description?: string
}

let replSet: MongoMemoryReplSet

test.serial.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members
  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  client.db('test')
})

test.before('Build the /test/resource1 endpoints', async (t) => {
  // Create the schema.
  const R1SubdocumentSchema = new mongoose.Schema({
    label: {
      type: String
    },
    data: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ref'
    }]
  }, { _id: false })

  const Resource1Schema = new mongoose.Schema({
    title: {
      type: String,
      required: true
    },
    name: {
      type: String
    },
    age: {
      type: Number
    },
    description: {
      type: String
    },
    list: [R1SubdocumentSchema],
    list2: [String]
  })

  // Create the model.
  const Resource1Model = mongoose.model('resource1', Resource1Schema)

  // Create the REST resource and continue.
  const resource1 = ResourceJS(app, '/test', 'resource1', Resource1Model).rest({
    async afterDelete (ctx: Koa.Context, next: Koa.Next) {
      // Check that the delete item is still being returned via resourcejs.
      t.not(ctx.state.resource.item, {})
      t.not(ctx.state.resource.item, [])
      t.is(ctx.state.resource.status, 204)
      t.is(ctx.status, 404) // In Koa the ctx status is changed in respond
      return await next()
    }
  })

  const { default: resource1Swaggerio } = await import('./OpenAPI/resource1.json', {
    assert: { type: 'json' }
  })
  const swaggerio = resource1.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.resource1)
  t.is((swaggerio.components?.schemas?.resource1 as OpenAPIV3.SchemaObject).title, 'resource1')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, resource1Swaggerio)
})

test.before('Build the /test/resource1/:resource1Id/nested1 endpoints', async (t) => {
  // Create the schema.
  const Nested1Schema = new mongoose.Schema({
    resource1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'resource1',
      index: true,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    age: {
      type: Number
    },
    description: {
      type: String
    }
  })

  // Create the model.
  const Nested1Model = mongoose.model('nested1', Nested1Schema)

  // Create the REST resource and continue.
  const nested1 = ResourceJS(app, '/test/resource1/:resource1Id', 'nested1', Nested1Model).rest({
    // Register before global handlers to set the resource1 variable.
    async before (ctx: Koa.Context, next: Koa.Next) {
      (ctx.request.body as any).resource1 = ctx.params.resource1Id
      return await next()
    }
  })
  const { default: nested1Swaggerio } = await import('./OpenAPI/nested1.json', {
    assert: { type: 'json' }
  })
  const swaggerio = nested1.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.nested1)
  t.is((swaggerio.components?.schemas?.nested1 as OpenAPIV3.SchemaObject).title, 'nested1')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, nested1Swaggerio)
})

test.serial('Test nested resource CRUD capabilities: /POST a new parent resource', async (t) => await request(server)
  .post('/test/resource1')
  .send({
    title: 'Test1',
    description: '123456789'
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1')
    t.is(response.description, '123456789')
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    resource = response
  }))

test.serial('Test nested resource CRUD capabilities: /GET an empty list of nested resources at the start', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}/nested1`)
  .expect('Content-Type', /json/)
  .expect('Content-Range', '*/0')
  .expect(200)
  .then((response) => {
    t.truthy(response.body)
    t.true(Array.isArray(response.body))
    t.true(response.body.length === 0)
  }))

test.serial('Test nested resource CRUD capabilities: /POST a new nested resource', async (t) => await request(server)
  .post(`/test/resource1/${resource._id}/nested1`)
  .send({
    title: 'Nest1',
    description: '987654321'
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Nest1')
    t.is(response.description, '987654321')
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    nested = response
  }))

test.serial('Test nested resource CRUD capabilities: /GET the list of nested resources', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, nested.title)
    t.is(response.description, nested.description)
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    t.is(response._id, nested._id)
  }))

test.serial('Test nested resource CRUD capabilities: /PUT the nested resource', async (t) => await request(server)
  .put(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .send({
    title: 'Nest1 - Updated1'
  })
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Nest1 - Updated1')
    t.is(response.description, nested.description)
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    t.is(response._id, nested._id)
    nested = response
  }))

test.serial('Test nested resource CRUD capabilities: /PATCH data on the nested resource', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .send([{ op: 'replace', path: '/title', value: 'Nest1 - Updated2' }])
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Nest1 - Updated2')
    t.is(response.description, nested.description)
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    t.is(response._id, nested._id)
    nested = response
  }))

test.serial('Test nested resource CRUD capabilities: /PATCH rejection on the nested resource due to failed test op', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .send([
    { op: 'test', path: '/title', value: 'not-the-title' },
    { op: 'replace', path: '/title', value: 'Nest1 - Updated3' }
  ])
  .expect('Content-Type', /json/)
  .expect(412)
  .then((res) => {
    const response = res.body
    t.is(response.title, nested.title)
    t.is(response.description, nested.description)
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    t.is(response._id, nested._id)
  }))

test.serial('Test nested resource CRUD capabilities: /GET the nested resource with patch changes', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, nested.title)
    t.is(response.description, nested.description)
    t.true(Object.hasOwn(response, 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response.resource1, resource._id)
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    t.is(response._id, nested._id)
  }))

test.serial('Test nested resource CRUD capabilities: /GET index of nested resources', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}/nested1`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, nested.title)
    t.is(response[0].description, nested.description)
    t.true(Object.hasOwn(response[0], 'resource1'), 'The response must contain the parent object `_id`')
    t.is(response[0].resource1, resource._id)
    t.true(Object.hasOwn(response[0], '_id'), 'The response must contain the mongo object `_id`')
    t.is(response[0]._id, nested._id)
  }))

test.serial('Test nested resource CRUD capabilities: Cannot /POST to an existing nested resource', async (t) => await request(server)
  .post(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .expect('Content-Type', /text\/plain/)
  .expect(405)
  .then((res) => {
    t.is(res.text, 'Method Not Allowed')
  }))

test.serial('Test nested resource CRUD capabilities: /DELETE the nested resource', async (t) => await request(server)
  .delete(`/test/resource1/${resource._id}/nested1/${nested._id}`)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.deepEqual(response, {})
  }))

test.serial('Test nested resource CRUD capabilities: /GET an empty list of nested resources at the end', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}/nested1/`)
  .expect('Content-Type', /json/)
  .expect('Content-Range', '*/0')
  .expect(200)
  .then((response) => {
    t.truthy(response.body)
    t.true(Array.isArray(response.body))
    t.true(response.body.length === 0)
  }))

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
