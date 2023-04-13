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
  const resource2 = ResourceJS(app, '/test', 'resource2', Resource2Model).rest({})

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

test.serial('Handle native data formats: Should create a new resource with boolean and string values set.', async (t) => await request(server)
  .post('/test/resource2')
  .send({
    title: 'null',
    description: 'false',
    married: true
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    t.is(response.married, true)
    t.is(response.title, 'null')
    t.is(response.description, 'false')
  }))

test('Handle native data formats: Should find the record when filtering the title as "null"', async (t) => await request(server)
  .get('/test/resource2?title=null')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
  }))

test('Handle native data formats: Should find the record when filtering the description as "false"', async (t) => await request(server)
  .get('/test/resource2?description=false')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].description, 'false')
  }))

test('Handle native data formats: Should find the record when filtering the description as "true"', async (t) => await request(server)
  .get('/test/resource2?description=true')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 0)
  }))

test('Handle native data formats: Should find the record when filtering the updated property as null with strict equality', async (t) => await request(server)
  .get('/test/resource2?updated__eq=null')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].updated, null)
  }))

test('Handle native data formats: Should still find the null values based on string if explicitely provided "null"', async (t) => await request(server)
  .get('/test/resource2?title__eq="null"')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
  }))

test('Handle native data formats: Should find the boolean false values based on equality', async (t) => await request(server)
  .get('/test/resource2?description__eq=false')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].married, true)
  }))

test('Handle native data formats: Should find the boolean true values based on equality', async (t) => await request(server)
  .get('/test/resource2?married__eq=true')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].married, true)
  }))

test('Handle native data formats: Should still find the boolean false based on string if explicitely provided', async (t) => await request(server)
  .get('/test/resource2?description__eq=%22false%22')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].married, true)
  }))

test('Handle native data formats: Should still find the boolean true based on string if explicitely provided', async (t) => await request(server)
  .get('/test/resource2?married__eq=%22true%22')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].married, true)
  }))

test('Handle native data formats: Should CAST a true to find the boolean values based on equals', async (t) => await request(server)
  .get('/test/resource2?married=true')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 1)
    t.is(response[0].title, 'null')
    t.is(response[0].married, true)
  }))

test('Handle native data formats: Should CAST a false to find the boolean values based on equals', async (t) => await request(server)
  .get('/test/resource2?married=false')
  .send()
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.length, 0)
  }))
