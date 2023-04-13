import { type Document, type Model, type Query, type PipelineStage, type Aggregate } from 'mongoose'
import type * as Koa from 'koa'
import KoaQs from 'koa-qs'

import compose from 'koa-compose'
import Router from '@koa/router'
import { createRequest, createResponse } from 'node-mocks-http'
import debugjs from 'debug'

import fjp from 'fast-json-patch'
import { type Operation } from 'fast-json-patch'
import { type ParsedUrlQuery } from 'querystring'
import { type OpenAPIV3 } from 'openapi-types'
import { zipObject, isObjectLike, isEmpty, get, paginate, getQueryValue, getQueryValueIntOrDefault, getMethodOptions, ObjectId } from './utils.js'
import { type InputOptions, type MethodOptions, type Methods, type ConfigMiddlewares, type MongooseQuery, type QueryParam, type VirtualInputOptions, type VirtualMethodOptions, type ResourceContext, type GetResourceContext, type PostResourceContext, type IndexResourceContext, type ModifyResourceContext, type DeleteResourceContext } from './types.js'
import swagger from './swagger.js'
const debug = {
  query: debugjs('resourcejs:query'),
  index: debugjs('resourcejs:index'),
  get: debugjs('resourcejs:get'),
  put: debugjs('resourcejs:put'),
  post: debugjs('resourcejs:post'),
  patch: debugjs('resourcejs:patch'),
  delete: debugjs('resourcejs:delete'),
  virtual: debugjs('resourcejs:virtual'),
  respond: debugjs('resourcejs:respond')
}

class Resource {
  #swagger: OpenAPIV3.Document<Record<string, unknown>> | undefined

  public app: Koa
  public router: Router
  public options: MethodOptions | InputOptions
  public name: string
  public model: Model<any>
  public modelName: string
  public route: string
  public methods: Set<Methods | `virtual/${string}`>
  public routeFixed: string | undefined
  public version: string = '1.0.0'
  public stack: any

  constructor (app: Koa, route: string, modelName: string, model: Model<any>, options?: InputOptions) {
    this.app = app
    KoaQs(app)
    this.router = new Router()
    this.options = options ?? {}
    if (this.options.convertIds === true) {
      this.options.convertIds = /(^|\.)_id$/
    }
    this.version = options?.version ?? this.version
    this.name = modelName.toLowerCase()
    this.model = model
    this.modelName = modelName
    this.route = `${route}/${this.name}`
    this.methods = new Set()
    this.stack = {}
  }

  /**
   * Add a stack processor to be able to execute the middleware independently of KoaJS.
   * Taken from https://github.com/koajs/koa/issues/842#issuecomment-562819849
   *
   * @param stack
   * @return {function(...[*]=)}
   */
  stackProcessor = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', middleware: Koa.Middleware) => (body?: any, params?: qs.ParsedQs, query?: ParsedUrlQuery) => {
    const request = createRequest({
      method,
      headers: {
        'content-type': 'application/json'
      }
    })
    const response = createResponse()
    const ctx = this.app.createContext(request, response)
    if (params != null) ctx.params = params
    if (query != null) ctx.query = query
    if (body != null) ctx.request.body = body
    const onerror = (err: Error): void => { ctx.onerror(err) }
    const handleResponse = (): Koa.Response => {
      return ctx.response
    }
    // @ts-expect-error middleware does not actually need next function
    return middleware(ctx).then(handleResponse).catch(onerror)
  }

  #generateMiddleware (options: MethodOptions, position: 'before' | 'after'): Koa.Middleware<any> {
    let routeStack: Array<Koa.Middleware<any>> | Koa.Middleware<any> = []
    const middleware = options[position]
    if (middleware != null) {
      const before = middleware.map((m) => m.bind(this))
      routeStack = [...routeStack, ...before]
    }
    routeStack = (routeStack.length > 0)
      ? compose(routeStack)
      : async (ctx: Koa.Context, next: Koa.Next) => {
        return await next()
      }
    return routeStack
  }

  /**
   * Register a new middleware but add before and after options to the middleware.
   *
   * @param {Methods} method
   * @param {string} path, url path to the resource
   * @param {ConfigMiddlewares} ConfigMiddlewares, contains beforeQuery, afterQuery and select ConfigMiddlewares
   * @param options, object, contains before, after and hook handlers
   */
  #register (method: Methods, path: string, ConfigMiddlewares: ConfigMiddlewares, options: MethodOptions): void {
    const { beforeQuery, query, afterQuery, after } = ConfigMiddlewares

    // The fallback error handler.
    const error: Koa.Middleware<any> = async (ctx: Koa.Context, next: Koa.Next) => {
      try {
        return await next()
      } catch (err: any) {
        ctx.status = ctx.state.resource?.status ?? ctx.status ?? 400
        ctx.body = {
          message: err.message ?? err
        }
      }
    }

    // The before middleware.
    const before = this.#generateMiddleware(options, 'before')

    const routeStack = compose([
      error,
      before,
      beforeQuery,
      options.hooks[method].before.bind(this),
      query,
      options.hooks[method].after.bind(this),
      afterQuery,
      after
    ])

    // Declare the resourcejs object on the app.
    if (this.app.context.resourcejs == null) {
      this.app.context.resourcejs = {}
    }

    if (this.app.context.resourcejs[path] == null) {
      this.app.context.resourcejs[path] = this
    }

    // Apply these callbacks to the application.
    switch (method) {
      case 'index':
      case 'get':
      case 'virtual':
        this.router.get(path, routeStack)
        // Add a stack processor so this stack can be executed independently of KoaJS.
        this.app.context.resourcejs[path].stack[method] = this.stackProcessor('GET', routeStack)
        break
      case 'post':
        this.router.post(path, routeStack)
        // Add a stack processor so this stack can be executed independently of KoaJS.
        this.app.context.resourcejs[path].stack[method] = this.stackProcessor('POST', routeStack)
        break
      case 'put':
        this.router.put(path, routeStack)
        // Add a stack processor so this stack can be executed independently of KoaJS.
        this.app.context.resourcejs[path].stack[method] = this.stackProcessor('PUT', routeStack)
        break
      case 'patch':
        this.router.patch(path, routeStack)
        // Add a stack processor so this stack can be executed independently of KoaJS.
        this.app.context.resourcejs[path].stack[method] = this.stackProcessor('PATCH', routeStack)
        break
      case 'delete':
        this.router.delete(path, routeStack)
        // Add a stack processor so this stack can be executed independently of KoaJS.
        this.app.context.resourcejs[path].stack[method] = this.stackProcessor('DELETE', routeStack)
        break
    }
    this.app.use(this.router.routes())
    this.app.use(this.router.allowedMethods())
  }

  /**
   * Sets the different responses based on the context state
   *
   * @param {Koa.Context} ctx
   */
  static async respond (ctx: ResourceContext): Promise<void> {
    if (ctx.headerSent) {
      debug.respond('Skipping')
      return
    }

    if (ctx.state.resource != null) {
      switch (ctx.state.resource.status) {
        case 404:
          ctx.status = 404
          ctx.body = {
            status: 404,
            errors: ['Resource not found']
          }
          break
        case 400:
        case 500:
          for (const property in ctx.state.resource.error.errors) {
            // eslint-disable-next-line max-depth
            if (Object.hasOwn(ctx.state.resource.error.errors, property)) {
              const error = ctx.state.resource.error.errors[property]
              const { path, name, message } = error
              ctx.state.resource.error.errors[property] = { path, name, message }
            }
          }
          ctx.status = ctx.state.resource.status
          ctx.body = {
            status: ctx.state.resource.status,
            message: ctx.state.resource.error.message,
            errors: ctx.state.resource.error.errors
          }
          break
        case 204:
          // Convert 204 into 200, to preserve the empty result set.
          // Update the empty response body based on request method type.
          debug.respond(`204 -> ${ctx.state.__rMethod}`)
          switch (ctx.state.__rMethod) {
            case 'index':
              ctx.status = 200
              ctx.body = ctx.body ?? []
              break
            default:
              ctx.status = 200
              ctx.body = ctx.body ?? {}
              break
          }
          break
        default:
          ctx.status = ctx.state.resource.status
          ctx.body = ctx.state.resource.item
          break
      }
    }
  }

  /**
   * #register the whole REST api for this resource.
   *
   * @param {InputOptions} options
   * @returns {Resource}
   */
  rest (options?: InputOptions): Resource {
    return this
      .index(options)
      .get(options)
      .virtual((options as VirtualInputOptions))
      .put(options)
      .patch(options)
      .post(options)
      .delete(options)
  }

  /**
   * Returns a query parameters fields.
   *
   * @param req
   * @param name
   * @returns {*}
   */
  static getParamQuery (ctx: Koa.Context, name: 'sort' | 'select'): string | null
  static getParamQuery (ctx: Koa.Context, name: 'populate'): string | string[] | null | undefined
  static getParamQuery (ctx: Koa.Context, name: 'populate' | 'select' | 'sort'): string | string[] | null | undefined {
    if (!Object.hasOwn(ctx.query, name)) {
      switch (name) {
        case 'populate':
          return ''
        default:
          return null
      }
    }

    if (name === 'populate' && isObjectLike(ctx.query[name])) {
      return ctx.query[name]
    } else {
      let query = ctx.query[name]
      if (query == null || query === '') return null
      if (Array.isArray(query)) query = query.join(',')
      // Generate string of spaced unique keys
      query = [...new Set(query.match(/[^, ]+/g))].join(' ')
      return query.length > 0 ? query : null
    }
  }

  /**
   * Get the find query for the index.
   *
   * @param {Koa.Context} ctx
   * @returns {Object}
   */
  getFindQuery (ctx: ResourceContext, options: MethodOptions, existing: Record<string, any> = {}): Record<string, any> {
    const findQuery: Record<string, any> = {}
    options = options ?? this.options

    // Get the filters and omit the limit, skip, select, sort and populate.
    const { limit, skip, select, sort, populate, ...filters } = (ctx.query as qs.ParsedQs)

    // Sets the findQuery property.
    const setFindQuery = function (name: string, value: QueryParam | RegExp): void {
      // Ensure we do not override any existing query parameters.
      if (!Object.hasOwn(existing, name)) {
        findQuery[name] = value
      }
    }

    // Iterate through each filter.
    for (const name in filters) {
      if (Object.hasOwn(filters, name)) {
        let value: QueryParam = filters[name]
        // Get the filter object.
        const filter: { name: string, selector: string } = (zipObject(['name', 'selector'], name.split('__')) as { name: string, selector: string })
        // See if this parameter is defined in our model.
        const param = this.model.schema.paths[filter.name.split('.')[0]]
        if (param != null && value != null) {
          // See if this selector is a regular expression.
          if (filter.selector === 'regex') {
            const values: any[] = Array.isArray(value) ? value : [value]
            for (const val of values) {
              if (typeof val !== 'string') continue
              // Set the regular expression for the filter.
              const match = val.match(/\/?([^/]+)\/?([^/]+)?/)
              let regex = null
              if (match != null) {
                const [, pattern, flags] = match
                regex = new RegExp(pattern, flags ?? 'i')
                setFindQuery(filter.name, regex)
              }
            }
            continue
          } else if (filter.selector != null && filter.selector !== '') {
            // See if there is a selector.
            let filterQuery = findQuery[filter.name]
            // Init the filter.
            if (filterQuery == null) {
              filterQuery = {}
            }

            if (filter.selector === 'exists') {
              value = ((value === 'true') || (value === '1')) ? true : value
              value = ((value === 'false') || (value === '0')) ? false : value
              value = Boolean(value)
            } else if (['in', 'nin'].includes(filter.selector)) {
              // Special case for in filter with multiple values.
              if (!Array.isArray(value) && typeof value === 'string') value = value.split(',')
              if (!Array.isArray(value)) value = [value]
              value = value.map((item: any) => getQueryValue(filter.name, item, param, options, filter.selector))
            } else {
              // Set the selector for this filter name.
              value = getQueryValue(filter.name, value, param, options, filter.selector)
            }
            filterQuery[`$${filter.selector}`] = value
            setFindQuery(filter.name, filterQuery)
            continue
          } else {
            // Set the find query to this value.
            value = getQueryValue(filter.name, value, param, options, filter.selector)
            setFindQuery(filter.name, value)
            continue
          }
        }

        if (options.queryFilter == null) {
          // Set the find query to this value.
          setFindQuery(filter.name, value)
        }
      }
    }
    // Return the findQuery.
    return findQuery
  }

  countQuery (query: Query<any, any>, pipeline: PipelineStage[]): Query<any, any> | {
    countDocuments: () => Promise<any>
  } {
    // We cannot use aggregation if mongoose special options are used... like populate.
    if (!isEmpty(query._mongooseOptions) || pipeline == null) {
      return query
    }
    const stages: PipelineStage[] = [
      { $match: query.getQuery() },
      ...pipeline,
      {
        $group: {
          _id: null,
          count: { $sum: 1 }
        }
      }
    ]
    return {
      async countDocuments () {
        const items = await query.model.aggregate(stages).exec()
        return (items.length > 0) ? items[0].count : 0
      }
    }
  }

  indexQuery (query: MongooseQuery, pipeline?: PipelineStage[]): Aggregate<any[]> | Query<any, any> {
    // We cannot use aggregation if mongoose special options are used... like populate.
    if (!isEmpty(query._mongooseOptions) || pipeline == null) {
      return query.lean()
    }

    const stages = [
      { $match: query.getQuery() },
      ...pipeline
    ]

    if (!isEmpty(query.options?.sort)) {
      stages.push({ $sort: query.options?.sort })
    }
    if (query.options?.skip != null) {
      stages.push({ $skip: query.options.skip })
    }
    if (query.options?.limit != null) {
      stages.push({ $limit: query.options.limit })
    }
    if (!isEmpty(query._fields)) {
      stages.push({ $project: query._fields })
    }
    return query.model.aggregate(stages)
  }

  /**
   * The index for a resource.
   *
   * @param {Options} options
   */
  index (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('index', options)
    this.methods.add('index')
    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])

    // eslint-disable-next-line max-statements
    const beforeQuery = async (ctx: IndexResourceContext, next: Koa.Next): Promise<any> => {
      debug.index('beforeQueryMiddleWare')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'index'

      // Allow before handlers the ability to disable resource CRUD.
      if (ctx.state.skipResource) {
        debug.index('Skipping Resource')
        return after(ctx, next)
      }

      // Get the query object.
      let countQuery: Model<any> | Query<any, any> = ctx.state.countQuery ?? ctx.state.modelQuery ?? ctx.state.model ?? this.model
      ctx.state.query = ctx.state.modelQuery ?? ctx.state.model ?? this.model

      // Get the find query.
      ctx.state.findQuery = this.getFindQuery(ctx, (options as MethodOptions), ctx.state.query._conditions)

      // Make sure to clone the count query if it is available.
      if ('clone' in countQuery && typeof countQuery.clone === 'function') {
        countQuery = countQuery.clone()
      }

      // First get the total count.
      let count
      try {
        // @ts-expect-error "This expression is not callable. ts(2349)"
        count = await this.countQuery(countQuery.find(ctx.state.findQuery), ctx.state.query.pipeline).countDocuments()
      } catch (err) {
        debug.index(err)
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }

      // Get the default limit.
      const defaults = { limit: 10, skip: 0 }
      const { limit, skip } = ctx.query
      const reqQuery = {
        limit: getQueryValueIntOrDefault(limit, defaults.limit),
        skip: getQueryValueIntOrDefault(skip, defaults.skip)
      }

      // If a skip is provided, then set the range headers.
      if (reqQuery.skip > 0 && ctx.headers.range == null) {
        ctx.headers['range-unit'] = 'items'
        ctx.headers.range = `${reqQuery.skip}-${reqQuery.skip + (reqQuery.limit - 1)}`
      }

      // Get the page range.
      const pageRange = paginate(ctx, count, reqQuery.limit) ?? {
        limit: reqQuery.limit,
        skip: reqQuery.skip
      }

      // Make sure that if there is a range provided in the headers, it takes precedence.
      if (ctx.headers.range != null) {
        reqQuery.limit = pageRange.limit
        reqQuery.skip = pageRange.skip
      }

      // Next get the items within the index.
      ctx.state.queryExec = (ctx.state.query as Query<any, any>)
        .find(ctx.state.findQuery)
        .limit(reqQuery.limit)
        .skip(reqQuery.skip)
        .select(Resource.getParamQuery(ctx, 'select'))
        .sort(Resource.getParamQuery(ctx, 'sort'))

      // Only call populate if they provide a populate query.
      ctx.state.populate = Resource.getParamQuery(ctx, 'populate')
      if (ctx.state.populate != null) {
        debug.index(`Populate: ${JSON.stringify(ctx.state.populate)}`)
        ctx.state.queryExec.populate(ctx.state.populate)
      }

      return await next()
    }

    const query = async (ctx: IndexResourceContext, next: Koa.Next): Promise<any> => {
      debug.index('queryMiddleware')
      try {
        const items = await this.indexQuery(ctx.state.queryExec, ctx.state.query.pipeline).exec()
        debug.index(items)
        ctx.state.item = items
      } catch (err: any) {
        debug.index(err)
        debug.index(err.name)

        if (err.name === 'CastError' && ctx.state.populate != null) {
          err.message = `Cannot populate "${JSON.stringify(ctx.state.populate)}" as it is not a reference in this resource`
          debug.index(err.message)
        }

        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      return await next()
    }
    const afterQuery = async (ctx: Koa.Context, next: Koa.Next): Promise<any> => {
      debug.index('afterQueryMiddleWare')
      ctx.state.resource = { status: ctx.status, item: ctx.state.item }
      return await next()
    }
    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }

    this.#register('index', this.route, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Register the GET method for this resource.
   */
  get (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('get', options)
    this.methods.add('get')
    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])

    const beforeQuery = async (ctx: GetResourceContext, next: Koa.Next): Promise<any> => {
      debug.get('beforeQueryMiddleware')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'get'
      if (ctx.state.skipResource) {
        debug.get('Skipping Resource')
        return after(ctx, next)
      }
      ctx.state.query = (ctx.state.modelQuery ?? ctx.state.model ?? this.model).findOne()
      ctx.state.search = { _id: ctx.params[`${this.name}Id`] }
      // Only call populate if they provide a populate query.
      const populate = Resource.getParamQuery(ctx, 'populate')
      if (populate != null) {
        debug.get(`Populate: ${JSON.stringify(populate)}`)
        ctx.state.query.populate(populate)
      }
      return await next()
    }

    const query = async (ctx: GetResourceContext, next: Koa.Next): Promise<any> => {
      debug.get('queryMiddleWare')
      try {
        ctx.state.item = await ctx.state.query.where(ctx.state.search).lean().exec()
      } catch (err) {
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      if (ctx.state.item == null) {
        ctx.state.resource = { status: 404 }
        return after(ctx, next)
      }
      return await next()
    }

    const afterQuery = async (ctx: GetResourceContext, next: Koa.Next): Promise<any> => {
      debug.get('afterMiddleWare (select)')
      // Allow them to only return specified fields.
      const select = Resource.getParamQuery(ctx, 'select')
      if (select != null && !Array.isArray(select)) {
        const newItem: Record<string, any> = {}
        // Always include the _id.
        if (ctx.state.item._id != null) {
          newItem._id = ctx.state.item._id
        }
        for (const key of select.split(' ')) {
          const trimmedKey = key.trim()
          if (Object.hasOwn(ctx.state.item, trimmedKey)) {
            newItem[trimmedKey] = ctx.state.item[trimmedKey]
          }
        }
        ctx.state.item = newItem
      }
      ctx.state.resource = { status: 200, item: ctx.state.item }
      return await next()
    }
    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('get', `${this.route}/:${this.name}Id`, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Virtual (GET) method. Returns a user-defined projection (typically an aggregate result)
   * derived from this resource
   * The virtual method expects at least the path and the before option params to be set.
   */
  virtual (options?: VirtualInputOptions | VirtualMethodOptions): this {
    if (options?.path == null || options?.path === '' || options?.before == null) return this
    const path = options.path
    const methodOptions = getMethodOptions('virtual', options)
    this.methods.add(`virtual/${path}`)

    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])
    const beforeQuery = async (ctx: IndexResourceContext, next: Koa.Next): Promise<any> => {
      debug.virtual('beforeQueryMiddleware')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'virtual'

      if (ctx.state.skipResource) {
        debug.virtual('Skipping Resource')
        return after(ctx, next)
      }
      ctx.state.query = ctx.state.modelQuery ?? ctx.state.model
      if (ctx.state.query == null) {
        ctx.state.resource = { status: 404 }
        return after(ctx, next)
      }

      return await next()
    }

    const query = async (ctx: GetResourceContext, next: Koa.Next): Promise<any> => {
      debug.virtual('queryMiddleWare')
      try {
        ctx.state.item = await ctx.state.query.exec()
      } catch (err) {
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      if (ctx.state.item == null) {
        ctx.state.resource = { status: 404 }
        return after(ctx, next)
      }
      return await next()
    }

    const afterQuery = async (ctx: Koa.Context, next: Koa.Next): Promise<any> => {
      debug.virtual('afterQueryMiddleWare')
      ctx.state.resource = { status: 200, item: ctx.state.item }
      return await next()
    }

    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('virtual', `${this.route}/virtual/${path}`, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Post (Create) a new item
   */
  post (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('post', options)
    this.methods.add('post')
    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])

    const beforeQuery = async (ctx: PostResourceContext, next: Koa.Next): Promise<any> => {
      debug.post('beforeQueryMiddleWare')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'post'

      if (ctx.state.skipResource) {
        debug.post('Skipping Resource')
        return after(ctx, next)
      }

      const Model = ctx.state.model ?? this.model
      if (Array.isArray(ctx.request.body) && (ctx.request.body.length > 0)) {
        ctx.state.many = true
        ctx.state.item = ctx.request.body.map((model) => new Model(model))
      } else {
        ctx.state.item = new Model(ctx.request.body)
      }
      return await next()
    }

    const query = async (ctx: PostResourceContext, next: Koa.Next): Promise<any> => {
      debug.post('queryMiddleWare')
      const writeOptions = ctx.state.writeOptions ?? {}
      try {
        if (ctx.state.many) {
          if (get(ctx, 'state.session.constructor.name') !== 'ClientSession') ctx.state.session = await this.model.startSession()
          if (!ctx.state.session.inTransaction()) ctx.state.session.startTransaction()
          writeOptions.session = ctx.state.session
          ctx.state.item = await Promise.all(ctx.state.item.map(async (item: Document) => await item.save(writeOptions)))
            .catch((err: Error) => {
              throw new Error(
                'Error occured while trying to save document into database',
                { cause: err }
              )
            })
          await ctx.state.session.commitTransaction()
        } else {
          ctx.state.item = await ctx.state.item.save(writeOptions)
        }
        debug.post(ctx.state.item)
      } catch (err: any) {
        debug.post(err)
        if (err.name === 'DatabaseError') {
          if (ctx.state.session.inTransaction()) await ctx.state.session.abortTransaction()
          await ctx.state.session.endSession()
        }
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      return await next()
    }

    const afterQuery = async (ctx: Koa.Context, next: Koa.Next): Promise<any> => {
      debug.post('afterQueryMiddleWare')
      ctx.state.resource = { status: 201, item: ctx.state.item }
      return await next()
    }

    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('post', this.route, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Put (Update) a resource.
   */
  put (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('put', options)
    this.methods.add('put')
    const after: Koa.Middleware<any, ModifyResourceContext> = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])
    const beforeQuery: Koa.Middleware<any, ModifyResourceContext> = async (ctx: ModifyResourceContext, next: Koa.Next) => {
      debug.put('beforeQueryMiddleWare')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'put'

      if (ctx.state.skipResource) {
        debug.put('Skipping Resource')
        return after(ctx, next)
      }

      // Remove __v field
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { __v, ...update } = (ctx.request.body as any)
      ctx.state.query = ctx.state.modelQuery ?? ctx.state.model ?? this.model
      try {
        ctx.state.item = await ctx.state.query.findOne({ _id: ObjectId(ctx.params[`${this.name}Id`]) }).exec()
      } catch (err) {
        debug.put(err)
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      if (ctx.state.item == null) {
        debug.put(`No ${this.name} found with ${this.name}Id: ${JSON.stringify(ctx.params[`${this.name}Id`])}`)
        ctx.state.resource = { status: 404 }
        return after(ctx, next)
      }
      ctx.state.item.set(update)
      return await next()
    }

    const query: Koa.Middleware<any, ModifyResourceContext> = async (ctx: ModifyResourceContext, next: Koa.Next) => {
      debug.put('queryMiddleWare')
      const writeOptions = ctx.state.writeOptions ?? {}
      try {
        ctx.state.item = await ctx.state.item.save(writeOptions)
        debug.put(ctx.state.item)
      } catch (err) {
        debug.put(err)
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      return await next()
    }

    const afterQuery: Koa.Middleware<any, ModifyResourceContext> = async (ctx: ModifyResourceContext, next: Koa.Next) => {
      debug.put('afterQueryMiddleWare')
      ctx.state.resource = { status: 200, item: ctx.state.item }
      return await next()
    }

    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('put', `${this.route}/:${this.name}Id`, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Patch (Partial Update) a resource.
   */
  patch (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('patch', options)
    this.methods.add('patch')
    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])
    const beforeQuery = async (ctx: ModifyResourceContext, next: Koa.Next): Promise<any> => {
      debug.patch('beforeQueryMiddleWare')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'patch'

      if (ctx.state.skipResource) {
        debug.patch('Skipping Resource')
        return after(ctx, next)
      }
      ctx.state.query = ctx.state.modelQuery ?? ctx.state.model ?? this.model
      try {
        ctx.state.item = await ctx.state.query.findOne({ _id: ctx.params[`${this.name}Id`] })
      } catch (err) {
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }

      if (ctx.state.item == null) {
        ctx.state.resource = { status: 404, error: '' }
        return after(ctx, next)
      }

      // Ensure patches is an array
      const patches: Operation[] = [].concat(ctx.request.body as any)
      let patchFail
      try {
        for (const patch of patches) {
          if (patch.op === 'test') {
            patchFail = patch
            const success = fjp.applyOperation(ctx.state.item, patch, true)
            if (success.test == null || !success.test) {
              ctx.state.resource = {
                status: 412,
                name: 'Precondition Failed',
                message: 'A json-patch test op has failed. No changes have been applied to the document',
                item: ctx.state.item,
                patch
              }
              return after(ctx, next)
            }
          }
        }
        fjp.applyPatch(ctx.state.item, patches, true)
      } catch (err: any) {
        switch (err.name) {
          // Check whether JSON PATCH error
          case 'TEST_OPERATION_FAILED':
            ctx.state.resource = {
              status: 412,
              name: 'Precondition Failed',
              message: 'A json-patch test op has failed. No changes have been applied to the document',
              item: ctx.state.item,
              patch: patchFail
            }
            return after(ctx, next)
          case 'SEQUENCE_NOT_AN_ARRAY':
          case 'OPERATION_NOT_AN_OBJECT':
          case 'OPERATION_OP_INVALID':
          case 'OPERATION_PATH_INVALID':
          case 'OPERATION_FROM_REQUIRED':
          case 'OPERATION_VALUE_REQUIRED':
          case 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED':
          case 'OPERATION_PATH_CANNOT_ADD':
          case 'OPERATION_PATH_UNRESOLVABLE':
          case 'OPERATION_FROM_UNRESOLVABLE':
          case 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX':
          case 'OPERATION_VALUE_OUT_OF_BOUNDS':
            err.errors = [{
              name: err.name,
              message: err.toString()
            }]
            ctx.state.resource = {
              status: 400,
              item: ctx.state.item,
              error: err
            }
            return after(ctx, next)
          // Something else than JSON PATCH
          default:
            ctx.state.resource = { status: 400, item: ctx.state.item, error: err }
            return after(ctx, next)
        }
      }
      return await next()
    }

    const query = async (ctx: ModifyResourceContext, next: Koa.Next): Promise<any> => {
      debug.patch('queryMiddleWare')
      const writeOptions = ctx.state.writeOptions ?? {}
      try {
        ctx.state.item = await ctx.state.item.save(writeOptions)
      } catch (err) {
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      return await next()
    }

    const afterQuery = async (ctx: ModifyResourceContext, next: Koa.Next): Promise<any> => {
      debug.patch('afterQueryMiddleWare')
      ctx.state.resource = { status: 200, item: ctx.state.item }
      return await next()
    }

    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('patch', `${this.route}/:${this.name}Id`, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Delete a resource.
   */
  delete (options?: InputOptions | MethodOptions): this {
    const methodOptions = getMethodOptions('delete', options)
    this.methods.add('delete')
    const after = compose([this.#generateMiddleware(methodOptions, 'after'), Resource.respond])
    const beforeQuery = async (ctx: DeleteResourceContext, next: Koa.Next): Promise<any> => {
      debug.delete('beforeQueryMiddleWare')
      // Store the internal method for response manipulation.
      ctx.state.__rMethod = 'delete'

      if (ctx.state.skipResource) {
        debug.delete('Skipping Resource')
        return after(ctx, next)
      }

      ctx.state.query = ctx.state.modelQuery ?? ctx.state.model ?? this.model

      try {
        ctx.state.item = await ctx.state.query.findOne({ _id: ctx.params[`${this.name}Id`] })
      } catch (err) {
        debug.delete(err)
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      if (ctx.state.item == null) {
        debug.delete(`No ${this.name} found with ${this.name}Id: ${ctx.params[`${this.name}Id`]}`)
        ctx.state.resource = { status: 404, error: '' }
        return after(ctx, next)
      }
      if (ctx.state.skipDelete) {
        ctx.state.resource = { status: 204, item: ctx.state.item, deleted: true }
        return after(ctx, next)
      }
      return await next()
    }

    const query = async (ctx: DeleteResourceContext, next: Koa.Next): Promise<any> => {
      debug.delete('queryMiddleWare')
      const writeOptions = ctx.state.writeOptions ?? {}
      try {
        ctx.state.item = await ctx.state.item.remove(writeOptions)
      } catch (err) {
        debug.delete(err)
        ctx.state.resource = { status: 400, error: err }
        return after(ctx, next)
      }
      debug.delete(ctx.state.item)
      return await next()
    }

    const afterQuery = async (ctx: DeleteResourceContext, next: Koa.Next): Promise<any> => {
      debug.delete('afterQueryMiddleWare')
      ctx.state.resource = { status: 204, item: ctx.state.item, deleted: true }
      return await next()
    }

    const ConfigMiddlewares = {
      beforeQuery,
      query,
      afterQuery,
      after
    }
    this.#register('delete', `${this.route}/:${this.name}Id`, ConfigMiddlewares, methodOptions)
    return this
  }

  /**
   * Returns the swagger definition for this resource.
   */
  swagger (resetCache?: boolean): OpenAPIV3.Document<Record<string, unknown>> {
    resetCache = (resetCache != null) || false
    if ((this.#swagger == null) || resetCache) {
      this.#swagger = swagger(this)
    }
    return this.#swagger
  }
}

// Make sure to create a new instance of the Resource class.
const ResourceFactory = (app: Koa, route: string, modelName: string, model: Model<any>, options?: InputOptions): Resource => {
  return new Resource(app, route, modelName, model, options)
}
ResourceFactory.Resource = Resource

export default ResourceFactory
export type { Resource }
