import type * as Koa from 'koa'
import { DateTime } from 'luxon'
import { type SchemaType } from 'mongoose'
import mongodb from 'mongodb'
import { type InputOptions, type MethodOptions, type Methods, type VirtualMethodOptions } from './types.js'

interface RangeObject {
  from: number
  to: number
}

interface LimitSkip {
  limit: number
  skip: number
}

export const zipObject = (props: string[], values: any[]): Record<string, any> => props.reduce((prev, prop, i) => Object.assign(prev, { [prop]: values[i] }), {})

export const isObjectLike = (obj: any): boolean => obj !== null && typeof obj === 'object'

export const get = (obj: any, path: string, defaultValue?: any): any => path.split('.').reduce((a, c) => (a?.[c] ?? (defaultValue ?? null)), obj)

export const set = (obj: any, path: string | string[], value: any): any => {
  if (Object(obj) !== obj) return obj // When obj is not an object
  // If not yet an array, get the keys from the string-path
  if (!Array.isArray(path)) path = path.toString().match(/[^.[\]]+/g) ?? []
  // eslint-disable-next-line no-return-assign
  path.slice(0, -1).reduce((a, c, i) => // Iterate all of them except the last one
    Object(a[c]) === a[c] // Does the key exist and is its value an object?
      // Yes: then follow that path
      ? a[c]
      // No: create the key. Is the next key a potential array-index?
      : a[c] = Math.abs(parseInt(path[i + 1])) >> 0 === +path[i + 1]
        ? [] // Yes: assign a new array object
        : {}, // No: assign a new plain object
  obj)[path[path.length - 1]] = value // Finally assign the value to the last key
  return obj // Return the top-level object to allow chaining
}

export const isEmpty = (obj: any): boolean => {
  return obj == null || (Object.entries(obj).length === 0 && obj.constructor === Object)
}

export const ObjectId = (id: string): any => {
  try {
    return (new mongodb.ObjectId(id))
  } catch (e) {
    return id
  }
}

/**
 * Parse range header string into an object
 * @param {string | undefined} hdr
 * @returns {RangeObject | null}
 */
function parseRange (hdr: string | undefined): RangeObject | null {
  const m = hdr?.match(/^(\d+)-(\d*)$/)
  if (m == null) {
    return null
  }
  const from = parseInt(m[1])
  const to = parseInt(m[2])
  return {
    from,
    to: isNaN(to) ? Infinity : to
  }
}

/**
   * Returns the method options for a specific method to be executed.
   * Idea is to organize each middleware so that they are in order: before --> beforeMethod --> after --> afterMethod
   * @param method
   * @param options
   * @returns {MethodOptions}
   */
export const getMethodOptions = (method: Methods, options?: InputOptions | MethodOptions): MethodOptions | VirtualMethodOptions => {
  if (options == null) {
    options = {}
  }

  // If this is already converted to method options then return.
  if (options.methodOptions != null) {
    return (options as MethodOptions)
  }

  // Uppercase the method.
  const Method = (method.charAt(0).toUpperCase() + method.slice(1).toLowerCase() as Capitalize<Methods>)
  const methodOptions: MethodOptions = {
    methodOptions: true,
    before: [],
    after: [],
    hooks: {}
  }
  const beforeMethod = options[`before${Method}`]
  const afterMethod = options[`after${Method}`]
  // Find all of the options that may have been passed to the rest method.
  if (options.before != null) methodOptions.before.push(options.before)
  if (beforeMethod != null) methodOptions.before.push(beforeMethod)

  if (options.after != null) methodOptions.after.push(options.after)
  if (afterMethod != null) methodOptions.after.push(afterMethod)

  // Expose mongoose hooks for each method.
  for (const type of ['before', 'after']) {
    const path = `hooks.${method}.${type}`

    set(
      methodOptions,
      path,
      get(options, path, async (ctx: Koa.Context, next: Koa.Next) => {
        return await next()
      })
    )
  }

  // Return the options for this method.
  return methodOptions
}

export const getQueryValue = (name: string, value: any, param: SchemaType, options: MethodOptions, selector: string): any => {
  if (value === undefined) return value
  if ((selector != null && selector.length > 0) && (selector === 'eq' || selector === 'ne') && (typeof value === 'string')) {
    const lcValue = value.toLowerCase()
    if (lcValue === 'null') {
      return null
    }
    if (lcValue === '"null"') {
      return 'null'
    }
    if (lcValue === 'true') {
      return true
    }
    if (lcValue === '"true"') {
      return 'true'
    }
    if (lcValue === 'false') {
      return false
    }
    if (lcValue === '"false"') {
      return 'false'
    }
  }

  if (param.instance === 'Number') {
    return parseInt(value, 10)
  }

  if (param.instance === 'Date') {
    const iso = DateTime.fromISO(value, { zone: 'utc' })
    if (iso.isValid) {
      return iso.toJSDate()
    }
    const ms = DateTime.fromMillis(Number(value), { zone: 'utc' })
    if (ms.isValid) {
      return ms.toJSDate()
    }
    // Try casting to date object. Even when invalid.
    return DateTime.fromJSDate(new Date(value), { zone: 'utc' }).toJSDate()
  }

  // If this is an ID, and the value is a string, convert to an ObjectId.
  if (
    (options.convertIds != null) &&
    (name.match(options.convertIds) != null) &&
    (typeof value === 'string') &&
    (mongodb.ObjectId.isValid(value))
  ) {
    try {
      value = ObjectId(value)
    } catch (err) {
      console.warn(`Invalid ObjectId: ${JSON.stringify(value)}`)
    }
  }
  return value
}
/**
 *
 * @param value
 * @param {number} defaultVal
 * @returns {number}
 */
export const getQueryValueIntOrDefault = (value: string | string[] | undefined, defaultVal: number): number => {
  let parsed: number = parseInt(value?.toString() ?? '', 10)
  parsed = (isNaN(parsed) || (parsed < 0)) ? defaultVal : parsed
  return parsed
}

/**
 * Fork of https://github.com/polo2ro/node-paginate-anything
 * Modify the http response for pagination, return 2 properties to use in a query
 *
 * @url https://github.com/begriffs/clean_pagination
 * @url http://nodejs.org/api/http.html#http_class_http_clientrequest
 * @url http://nodejs.org/api/http.html#http_class_http_serverresponse
 *
 *
 * @param {Koa.Context}         ctx             A Koa Context encapsulates node's request and response objects into a single object
 * @param {number}              totalItems      total number of items available, can be Infinity
 * @param {number}              maxRangeSize
 *
 * @return {LimitSkip | undefined}
 *      .limit  Number of items to return
 *      .skip   Zero based position for the first item to return
 */

// eslint-disable-next-line max-statements
export const paginate = function (ctx: Koa.Context, totalItems: number, maxRangeSize: string | number): LimitSkip | undefined {
  ctx.set('Accept-Ranges', 'items')
  ctx.set('Range-Unit', 'items')
  ctx.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Range-Unit')

  maxRangeSize = Number(maxRangeSize)

  let range: RangeObject = {
    from: 0,
    to: (totalItems - 1)
  }

  if (ctx.headers['range-unit'] === 'items') {
    range = parseRange(ctx.headers.range) ?? range
  }

  if ((range.to !== null && range.from > range.to) || (range.from > 0 && range.from >= totalItems)) {
    if (totalItems > 0 || range.from !== 0) {
      ctx.status = 416 // Requested range unsatisfiable
    } else {
      ctx.status = 204 // No content
    }
    ctx.set('Content-Range', `*/${totalItems}`)
    return
  }

  let availableTo
  let reportTotal

  if (totalItems < Infinity) {
    availableTo = Math.min(
      range.to,
      totalItems - 1,
      range.from + maxRangeSize - 1
    )

    reportTotal = totalItems
  } else {
    availableTo = Math.min(
      range.to,
      range.from + maxRangeSize - 1
    )

    reportTotal = '*'
  }

  ctx.set('Content-Range', `${range.from}-${availableTo}/${reportTotal}`)

  const availableLimit = availableTo - range.from + 1

  if (availableLimit === 0) {
    ctx.status = 204 // no content
    ctx.set('Content-Range', '*/0')
    return
  }

  if (availableLimit < totalItems) {
    ctx.status = 206 // Partial contents
  } else {
    ctx.status = 200 // OK (all items)
  }

  // Links
  function buildLink (rel: 'next' | 'prev' | 'first' | 'last', itemsFrom: number, itemsTo: number): string {
    const to = itemsTo < Infinity ? itemsTo : ''
    return `<${ctx.url}>; rel="${rel}"; items="${itemsFrom}-${to}"`
  }

  const requestedLimit = range.to - range.from + 1
  const links = []

  if (availableTo < totalItems - 1) {
    links.push(buildLink('next',
      availableTo + 1,
      availableTo + requestedLimit
    ))

    if (totalItems < Infinity) {
      const lastStart = Math.floor((totalItems - 1) / availableLimit) * availableLimit

      links.push(buildLink('last',
        lastStart,
        lastStart + requestedLimit - 1
      ))
    }
  }

  if (range.from > 0) {
    const previousFrom = Math.max(0, range.from - Math.min(requestedLimit, maxRangeSize))
    links.push(buildLink('prev',
      previousFrom,
      previousFrom + requestedLimit - 1
    ))

    links.push(buildLink('first',
      0,
      requestedLimit - 1
    ))
  }

  ctx.set('Link', links.join(', '))

  // return values named from mongoose methods
  return {
    limit: availableLimit,
    skip: range.from
  }
}
