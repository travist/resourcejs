import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import Resource from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { DateTime } from 'luxon'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()
app.use(bodyParser())
const server = app.listen()

const baseTestDate = DateTime.fromISO('2018-04-12T12:00:00.000Z', { zone: 'utc' })
const testDates = [
  baseTestDate, // actual
  baseTestDate.minus({ day: 1 }), // oneDayAgo
  baseTestDate.minus({ month: 1 }), // oneMonthAgo
  baseTestDate.minus({ year: 1 }) // oneYearAgo
]

// The raw connection to mongo, for consistency checks with mongoose.
let replSet: MongoMemoryReplSet

test.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members

  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  client.db('test')
})

test.serial.only('Build the /test/date endpoints and fill it with data', async (t) => {
  const Schema = new mongoose.Schema({
    date: {
      type: Date
    }
  })

  // Create the model.
  const Model = mongoose.model('date', Schema)

  const date = Resource(app, '/test', 'date', Model).rest()
  const { default: resource3Swaggerio } = await import('./OpenAPI/date.json', {
    assert: { type: 'json' }
  })
  const swaggerio = date.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.truthy(swaggerio.components)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.date)
  t.is((swaggerio.components?.schemas?.date as OpenAPIV3.SchemaObject).title, 'date')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, resource3Swaggerio)
  const dates = await Promise.all(testDates.map(async (date) => await request(server)
    .post('/test/date')
    .send({
      date: date.toJSDate()
    })))
  console.log(dates.map(r => r.body))
})

test('Should have 4 items', async (t) => await request(server)
  .get('/test/date')
  .then(({ body: response }) => t.is(response.length, 4)))

test('Should search by ISO date', async (t) => {
  const isoString = testDates[0].toString()

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__lt=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__lte=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 4)),
    request(server)
      .get(`/test/date?date__gte=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__gt=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__ne=${isoString}`)
      .then(({ body: response }) => t.is(response.length, 3))
  ])
})

test('Should search by YYYY-MM-DD format', async (t) => {
  const search = testDates[0].toFormat('yyyy-MM-dd')

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .then(({ body: response }) => t.is(response.length, 4))
  ])
})

test('Should search by YYYY-MM format', async (t) => {
  const search = testDates[0].toFormat('yyyy-MM')

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .then(({ body: response }) => t.is(response.length, 2)),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .then(({ body: response }) => t.is(response.length, 2)),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .then(({ body: response }) => t.is(response.length, 2)),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .then(({ body: response }) => t.is(response.length, 2)),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .then(({ body: response }) => t.is(response.length, 4))
  ])
})

test('Should search by YYYY format', async (t) => {
  const search = testDates[0].toFormat('yyyy')

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .then(({ body: response }) => t.is(response.length, 4))
  ])
})

test('Should search by timestamp', async (t) => {
  const search = testDates[0].toFormat('x')

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .then(({ body: response }) => t.is(response.length, 4)),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .then(({ body: response }) => t.is(response.length, 3))
  ])
})

test.only('Should search with non-standard format (Valid new Date string)', async (t) => {
  const search = encodeURIComponent(testDates[0].toRFC2822() as string)
  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .then(({ body: response }) => t.is(response.length, 3)),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .then(({ body: response }) => t.is(response.length, 4)),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .then(({ body: response }) => t.is(response.length, 1)),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .then(({ body: response }) => t.is(response.length, 0)),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .then(({ body: response }) => t.is(response.length, 3))
  ])
})

test('Should search with non-standard format (Invalid new Date String)', async (t) => {
  const search = 'Invalid DateTime'

  return await Promise.all([
    request(server)
      .get(`/test/date?date=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"')),
    request(server)
      .get(`/test/date?date__lt=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"')),
    request(server)
      .get(`/test/date?date__lte=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"')),
    request(server)
      .get(`/test/date?date__gte=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"')),
    request(server)
      .get(`/test/date?date__gt=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"')),
    request(server)
      .get(`/test/date?date__ne=${search}`)
      .expect(400)
      .then(({ body: response }) => t.is(response.message, 'Cast to date failed for value "Invalid Date" (type Date) at path "date" for model "date"'))
  ])
})

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
