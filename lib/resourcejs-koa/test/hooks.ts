import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS, { type Resource } from '../resource.js'
import { MongoClient } from 'mongodb'
import { faker } from '@faker-js/faker'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { type OpenAPIV3 } from 'openapi-types'

const app = new Koa()
const server = app.listen()

type CallMethods = 'before' | 'after'

let sub: { _id: string }
let calls: CallMethods[] = []

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

test.before('Test before hooks: Create the hook schema', (t) => {
  // Create the schema.
  const hookSchema = new mongoose.Schema({
    data: {
      type: String,
      required: true
    }
  })
  // Create the model.
  const hookModel = mongoose.model('hook', hookSchema)
  // Create the REST resource and continue.
  const hooks = ResourceJS(app, '', 'hook', hookModel)
    .rest({
      hooks: {
        post: {
          async before (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 0)
            calls.push('before')
            return await next()
          },
          async after (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 1)
            t.deepEqual(calls, ['before'])
            calls.push('after')
            return await next()
          }
        },
        get: {
          async before (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 0)
            calls.push('before')
            return await next()
          },
          async after (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 1)
            t.deepEqual(calls, ['before'])
            calls.push('after')
            return await next()
          }
        },
        put: {
          async before (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 0)
            calls.push('before')
            return await next()
          },
          async after (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 1)
            t.deepEqual(calls, ['before'])
            calls.push('after')
            return await next()
          }
        },
        delete: {
          async before (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 0)
            calls.push('before')
            return await next()
          },
          async after (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 1)
            t.deepEqual(calls, ['before'])
            calls.push('after')
            return await next()
          }
        },
        index: {
          async before (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 0)
            calls.push('before')
            return await next()
          },
          async after (ctx: Koa.Context, next: Koa.Next) {
            t.is(calls.length, 1)
            t.deepEqual(calls, ['before'])
            calls.push('after')
            return await next()
          }
        }
      }
    })
  const swaggerio = hooks.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.hook)
  t.is((swaggerio.components?.schemas?.hook as OpenAPIV3.SchemaObject).title, 'hook')
  t.is(Object.values(swaggerio.paths).length, 2)
})
test.beforeEach(t => {
  calls = []
})
test.serial('Post hooks: Bootstrap some test resources', async (t) => await request(server)
  .post('/hook')
  .send({
    data: faker.word.noun()
  })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    sub = response
    t.is(calls.length, 2)
    t.is(calls[0], 'before')
    t.is(calls[1], 'after')
  }))

test.serial('Post hooks: test required validation', async (t) => await request(server)
  .post('/hook')
  .send({})
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 1)
    t.is(calls[0], 'before')
    t.truthy(response?.message, 'hook validation failed')
  }))

test.serial('Get hooks: Get hooks: Call hooks are called in order', async (t) => await request(server)
  .get(`/hook/${sub._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then(() => {
    t.is(calls.length, 2)
    t.is(calls[0], 'before')
    t.is(calls[1], 'after')
  }))

test.serial('Get hooks: test undefined resource', async (t) => await request(server)
  .get('/hook/undefined')
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 1)
    t.is(calls[0], 'before')
    t.is(response?.message, 'Cast to ObjectId failed for value "undefined" (type string) at path "_id" for model "hook"')
  }))

test.serial('Get hooks: test unknown resource', async (t) => await request(server)
  .get('/hook/000000000000000000000000')
  .expect('Content-Type', /json/)
  .expect(404)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 1)
    t.is(calls[0], 'before')
    t.is(response?.errors?.[0], 'Resource not found')
  }))

test.serial('Put hooks: Call hooks are called in order', async (t) => await request(server)
  .put(`/hook/${sub._id}`)
  .send({
    data: faker.word.noun()
  })
  .expect('Content-Type', /json/)
  .expect(200)
  .then(() => {
    t.is(calls.length, 2)
    t.is(calls[0], 'before')
    t.is(calls[1], 'after')
  }))

test.serial('Put hooks: test undefined resource', async (t) => await request(server)
  .put('/hook/undefined')
  .send({
    data: faker.word.noun()
  })
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 0)
    t.is(response?.message, 'Cast to ObjectId failed for value "undefined" (type string) at path "_id" for model "hook"')
  }))

test.serial('Put hooks: test unknown resource', async (t) => await request(server)
  .put('/hook/000000000000000000000000')
  .send({
    data: faker.word.noun()
  })
  .expect('Content-Type', /json/)
  .expect(404)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 0)
    t.is(response?.errors?.[0], 'Resource not found')
  }))

test.serial('Delete hooks: Call hooks are called in order', async (t) => await request(server)
  .delete(`/hook/${sub._id}`)
  .expect('Content-Type', /json/)
  .expect(200)
  .then(() => {
    t.is(calls.length, 2)
    t.is(calls[0], 'before')
    t.is(calls[1], 'after')
  }))

test.serial('Delete hooks: test undefined resource', async (t) => await request(server)
  .delete('/hook/undefined')
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 0)
    t.is(response.message, 'Cast to ObjectId failed for value "undefined" (type string) at path "_id" for model "hook"')
  }))

test.serial('Delete hooks: test unknown resource', async (t) => await request(server)
  .delete('/hook/000000000000000000000000')
  .expect('Content-Type', /json/)
  .expect(404)
  .then((res) => {
    const response = res.body
    t.is(calls.length, 0)
    t.is(response?.errors?.[0], 'Resource not found')
  }))

test.serial('Index hooks: Call hooks are called in order', async (t) => await request(server)
  .get('/hook')
  .expect('Content-Type', /json/)
  .expect(200)
  .then(() => {
    t.is(calls.length, 2)
    t.is(calls[0], 'before')
    t.is(calls[1], 'after')
  }))

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
