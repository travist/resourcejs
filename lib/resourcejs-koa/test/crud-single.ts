import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import Resource from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

// An object to store handler events.

let resource: {
  _id: string
  title?: string
  age?: number
  married?: boolean
  updated?: Date
  description?: string
}

// The raw connection to mongo, for consistency checks with mongoose.
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

test.serial.before('Build the /test/resource1 endpoints', async (t) => {
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
  const resource1 = Resource(app, '/test', 'resource1', Resource1Model).rest({
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

test.serial('Test single resource CRUD capabilities: /GET empty list at the start', async (t) => await request(server)
  .get('/test/resource1')
  .expect('Content-Type', /json/)
  .expect('Content-Range', '*/0')
  .expect(200)
  .then((res) => {
    t.truthy(res.body)
    t.true(Array.isArray(res.body))
    t.true(res.body.length === 0)
  }))

test.serial('Test single resource CRUD capabilities: /POST Reject because empty array', async (t) => await request(server)
  .post('/test/resource1')
  .send([])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const error = res.body
    t.is(error.message, 'resource1 validation failed: title: Path `title` is required.')
    t.true(Object.hasOwn(error, 'errors'), 'errors not found')
  }))

/* test.serial('Test single resource CRUD capabilities: /POST Reject because not replicaSet', (t) => request(server)
  .post('/test/resource1')
  .send([{
    title: 'Test1',
    description: '12345678',
  }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const error = res.body;
    t.is(error.message, 'Error occured while trying to save document into database');
    t.true(error.hasOwnProperty('errors'), 'errors not found');
    t.is(error.errors[0].name, 'MongoError');
  })); */

test.serial('Test single resource CRUD capabilities: /POST Array succeeds with replicaSet', async (t) => await request(server)
  .post('/test/resource1')
  .send([{
    title: 'Test2',
    description: '87654321'
  }])
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    t.is(res.body.length, 1);
    [resource] = res.body
    t.is(resource.title, 'Test2')
    t.is(resource.description, '87654321')
    t.true(Object.hasOwn(resource, '_id'), 'Resource ID not found')
  }))

test.serial('Test single resource CRUD capabilities: /DELETE Should work on Array added item', async (t) => await request(server)
  .delete(`/test/resource1/${resource._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.deepEqual(res.body, {})
  }))

test.serial('Test single resource CRUD capabilities: /POST Create new resource', async (t) => await request(server)
  .post('/test/resource1')
  .send({
    title: 'Test1',
    description: '12345678'
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    resource = res.body
    t.is(resource.title, 'Test1')
    t.is(resource.description, '12345678')
    t.true(Object.hasOwn(resource, '_id'), 'Resource ID not found')
  }))

test.serial('Test single resource CRUD capabilities: /GET The new resource', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.is(res.body.title, resource.title)
    t.is(res.body.description, resource.description)
    t.is(res.body._id, resource._id)
  }))

test.serial('Test single resource CRUD capabilities: /PUT Change data on the resource', async (t) => await request(server)
  .put(`/test/resource1/${resource._id}`)
  .send({
    title: 'Test2'
  })
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.is(res.body.title, 'Test2')
    t.is(res.body.description, resource.description)
    t.is(res.body._id, resource._id)
    resource = res.body
  }))

test.serial('Test single resource CRUD capabilities: /PATCH Change data on the resource', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'replace', path: '/title', value: 'Test3' }])
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.is(res.body.title, 'Test3')
    resource = res.body
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to failed test op', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([
    { op: 'test', path: '/title', value: 'not-the-title' },
    { op: 'replace', path: '/title', value: 'Test4' }
  ])
  .expect('Content-Type', /json/)
  .expect(412)
  .then((res) => {
    t.is(res.body.title, 'Test3')
    resource = res.body
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch operation', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'does-not-exist', path: '/title', value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_OP_INVALID')
  }))

test('Test single resource CRUD capabilities: /PATCH Should not care whether patch is array or not', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send({ op: 'test', path: '/title', value: 'Test3' })
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.is(res.body.title, 'Test3')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch object', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send(['invalid-patch'])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_NOT_AN_OBJECT')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch value', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'replace', path: '/title', value: undefined }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_VALUE_REQUIRED')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch add path', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'add', path: '/path/does/not/exist', value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to unresolvable patch path', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'replace', path: '/path/does/not/exist', value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_PATH_UNRESOLVABLE')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to invalid patch path', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'replace', path: 1, value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_PATH_INVALID')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch path', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'add', path: '/path/does/not/exist', value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to from patch path unresolvable', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'move', from: '/path/does/not/exist', path: '/path/does/not/exist', value: 'Test4' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_FROM_UNRESOLVABLE')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to illegal patch array index', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'add', path: '/list/invalidindex', value: '2' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX')
  }))

test('Test single resource CRUD capabilities: /PATCH Reject update due to out of bound patch array index', async (t) => await request(server)
  .patch(`/test/resource1/${resource._id}`)
  .send([{ op: 'add', path: '/list/9999', value: '2' }])
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    t.is(res.body.errors[0].name, 'OPERATION_VALUE_OUT_OF_BOUNDS')
  }))

test.serial.after('Test single resource CRUD capabilities: /GET The changed resource', async (t) => await request(server)
  .get(`/test/resource1/${resource._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    t.is(res.body.title, resource.title)
    t.is(res.body.description, resource.description)
    t.is(res.body._id, resource._id)
  }))

test.serial.after('Test single resource CRUD capabilities: /GET index of resources', async (t) => await request(server)
  .get('/test/resource1')
  .expect('Content-Type', /json/)
  .expect('Content-Range', '0-0/1')
  .expect(200)
  .then((res) => {
    t.is(res.body.length, 1)
    t.is(res.body[0].title, 'Test3')
    t.is(res.body[0].description, resource.description)
    t.is(res.body[0]._id, resource._id)
  }))

test.serial.after('Test single resource CRUD capabilities: Cannot /POST to an existing resource', async (t) => await request(server)
  .post(`/test/resource1/${resource._id}`)
  .expect('Content-Type', /text\/plain/)
  .expect(405)
  .then((res) => {
    t.is(res.text, 'Method Not Allowed')
  }))

test.serial.after('Test single resource CRUD capabilities: /DELETE the resource', async (t) => await request(server)
  .delete(`/test/resource1/${resource._id}`)
  .expect(200)
  .then((res) => {
    t.deepEqual(res.body, {})
  }))

test.serial.after('Test single resource CRUD capabilities: /GET empty list at the end', async (t) => await request(server)
  .get('/test/resource1')
  .expect('Content-Type', /json/)
  .expect('Content-Range', '*/0')
  .expect(200)
  .then((res) => {
    t.truthy(res.body)
    t.true(Array.isArray(res.body))
    t.true(res.body.length === 0)
  }))

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
