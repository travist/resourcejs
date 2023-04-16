import test from 'ava'
import Koa from 'koa'
import mongoose from 'mongoose'
import ResourceJS, { type Resource } from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()

// An object to store handler events.

let resource: {
  _id: string
  title?: string
  age?: number
  married?: boolean
  updated?: Date
  description?: string
}

let resource1: Resource

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
  resource1 = ResourceJS(app, '/test', 'resource1', Resource1Model).rest({})
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

test('ResourceJS should produce an independent API-mimic stack', (t) => {
  t.truthy(resource1)
  t.truthy(resource1.stack)
  t.truthy(resource1.stack.index instanceof Function)
  t.truthy(resource1.stack.get instanceof Function)
  t.truthy(resource1.stack.post instanceof Function)
  t.truthy(resource1.stack.put instanceof Function)
  t.truthy(resource1.stack.patch instanceof Function)
  t.truthy(resource1.stack.delete instanceof Function)
})

test.serial('Test single resource CRUD capabilities: /GET empty list at the start', async (t) => {
  const response = await resource1.stack.index()
  t.truthy(response)
  t.is(response.status, 200)
  t.truthy(response.body)
  t.true(Array.isArray(response.body))
  t.true(response.body.length === 0)
})

test('Test single resource CRUD capabilities: /POST Reject because empty array', async (t) => {
  const response = await resource1.stack.post([])
  t.truthy(response)
  t.is(response.status, 400)
  t.truthy(response.body)
  t.is(response.body.message, 'resource1 validation failed: title: Path `title` is required.')
  t.true(Object.hasOwn(response.body, 'errors'), 'errors not found')
})

test.serial('Test single resource CRUD capabilities: /POST Array succeeds with replicaSet', async (t) => {
  const response = await resource1.stack.post([{
    title: 'Test2',
    description: '87654321'
  }])
  t.truthy(response)
  t.is(response.status, 201)
  t.is(response.body.length, 1);
  [resource] = response.body
  t.is(resource.title, 'Test2')
  t.is(resource.description, '87654321')
  t.truthy(resource._id, 'Resource ID not found')
})

test.serial('Test single resource CRUD capabilities: /DELETE Should work on Array added item', async (t) => {
  const response = await resource1.stack.delete(undefined, { resource1Id: resource._id })
  t.truthy(response)
  t.is(response.status, 200)
  t.deepEqual(response.body, {})
})

test.serial('Test single resource CRUD capabilities: /POST Create new resource', async (t) => {
  const response = await resource1.stack.post({
    title: 'Test1',
    description: '12345678'
  })
  t.truthy(response)
  t.is(response.status, 201)
  resource = response.body
  t.is(resource.title, 'Test1')
  t.is(resource.description, '12345678')
  t.truthy(resource._id, 'Resource ID not found')
})

test.serial('Test single resource CRUD capabilities: /GET The new resource', async (t) => {
  const response = await resource1.stack.get(undefined, { resource1Id: resource._id })
  t.is(response.status, 200)
  t.is(response.body.title, resource.title)
  t.is(response.body.description, resource.description)
  t.is(response.body._id.toString(), resource._id.toString())
})

test.serial('Test single resource CRUD capabilities: /PUT Change data on the resource', async (t) => {
  const response = await resource1.stack.put({
    title: 'Test2'
  }, { resource1Id: resource._id })
  t.is(response.status, 200)
  t.is(response.body.title, 'Test2')
  t.is(response.body.description, resource.description)
  t.is(response.body._id.toString(), resource._id.toString())
  resource = response.body
})

test.serial('Test single resource CRUD capabilities: /PATCH Change data on the resource', async (t) => {
  const response = await resource1.stack.patch([{ op: 'replace', path: '/title', value: 'Test3' }], { resource1Id: resource._id })
  t.is(response.status, 200)
  t.is(response.body.title, 'Test3')
  t.is(response.body.description, resource.description)
  t.is(response.body._id.toString(), resource._id.toString())
  resource = response.body
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to failed test op', async (t) => {
  const response = await resource1.stack.patch([
    { op: 'test', path: '/title', value: 'not-the-title' },
    { op: 'replace', path: '/title', value: 'Test4' }
  ], { resource1Id: resource._id })
  t.is(response.status, 412)
  t.is(response.body.title, 'Test3')
  t.is(response.body.description, resource.description)
  t.is(response.body._id.toString(), resource._id.toString())
  resource = response.body
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch operation', async (t) => {
  const response = await resource1.stack.patch([{ op: 'does-not-exist', path: '/title', value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_OP_INVALID')
})

test('Test single resource CRUD capabilities: /PATCH Should not care whether patch is array or not', async (t) => {
  const response = await resource1.stack.patch({ op: 'test', path: '/title', value: 'Test3' }, { resource1Id: resource._id })
  t.is(response.status, 200)
  t.is(response.body.title, 'Test3')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch object', async (t) => {
  const response = await resource1.stack.patch(['invalid-patch'], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_NOT_AN_OBJECT')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch value', async (t) => {
  const response = await resource1.stack.patch([{ op: 'replace', path: '/title', value: undefined }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_VALUE_REQUIRED')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch add path', async (t) => {
  const response = await resource1.stack.patch([{ op: 'add', path: '/path/does/not/exist', value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to unresolvable patch path', async (t) => {
  const response = await resource1.stack.patch([{ op: 'replace', path: '/path/does/not/exist', value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_PATH_UNRESOLVABLE')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to invalid patch path', async (t) => {
  const response = await resource1.stack.patch([{ op: 'replace', path: 1, value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_PATH_INVALID')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to incorrect patch path', async (t) => {
  const response = await resource1.stack.patch([{ op: 'add', path: '/path/does/not/exist', value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to from patch path unresolvable', async (t) => {
  const response = await resource1.stack.patch([{ op: 'move', from: '/path/does/not/exist', path: '/path/does/not/exist', value: 'Test4' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_FROM_UNRESOLVABLE')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to illegal patch array index', async (t) => {
  const response = await resource1.stack.patch([{ op: 'add', path: '/list/invalidindex', value: '2' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX')
})

test('Test single resource CRUD capabilities: /PATCH Reject update due to out of bound patch array index', async (t) => {
  const response = await resource1.stack.patch([{ op: 'add', path: '/list/9999', value: '2' }], { resource1Id: resource._id })
  t.is(response.status, 400)
  t.is(response.body.errors[0].name, 'OPERATION_VALUE_OUT_OF_BOUNDS')
})

test('Test single resource CRUD capabilities: /GET The changed resource', async (t) => {
  const response = await resource1.stack.get(undefined, { resource1Id: resource._id })
  t.is(response.status, 200)
  t.is(response.body.title, resource.title)
  t.is(response.body.description, resource.description)
  t.is(response.body._id.toString(), resource._id.toString())
})

test('Test single resource CRUD capabilities: /GET index of resources', async (t) => {
  const response = await resource1.stack.index()
  t.truthy(response.header['content-range'])
  t.is(response.header['content-range'], '0-0/1')
  t.is(response.status, 200)
  t.is(response.body.length, 1)
  t.is(response.body[0].title, 'Test3')
  t.is(response.body[0].description, resource.description)
  t.is(response.body[0]._id.toString(), resource._id.toString())
})

test('Test single resource Query capabilities: title incorrect', async (t) => {
  const response = await resource1.stack.index(undefined, undefined, { title: 'not-found' })
  t.truthy(response.header['content-range'])
  t.is(response.header['content-range'], '*/0')
  t.is(response.status, 200)
  t.is(response.body.length, 0)
})

test('Test single resource Query capabilities: title regex', async (t) => {
  const response = await resource1.stack.index(undefined, undefined, { regex__title: '^Title.' })
  t.truthy(response.header['content-range'])
  t.is(response.header['content-range'], '0-0/1')
  t.is(response.status, 200)
  t.is(response.body.length, 1)
  t.is(response.body[0].title, 'Test3')
  t.is(response.body[0].description, resource.description)
  t.is(response.body[0]._id.toString(), resource._id.toString())
})

test.serial.after('Test single resource CRUD capabilities: /DELETE the resource', async (t) => {
  const response = await resource1.stack.delete(undefined, { resource1Id: resource._id })
  t.is(response.status, 200)
  t.deepEqual(response.body, {})
})

test.serial.after('Test single resource CRUD capabilities: /GET empty list at the end', async (t) => {
  const response = await resource1.stack.index()
  t.truthy(response)
  t.is(response.status, 200)
  t.truthy(response.body)
  t.true(Array.isArray(response.body))
  t.true(response.body.length === 0)
})

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
