var Utils = require("./utils")
var Query = module.exports = function(pool, callee, options) {
  this.callee = callee
  this.options = options || {}
  this.startTime = Date.now()
  this.pool = pool
}
Utils.addEventEmitter(Query)


Query.prototype.run = function(query) {
  var self = this
  this.sql = query

  if(this.options.logging)
      console.log('Executing: ' + this.sql)

  this.pool.acquire(function (err, client) {
      if (err)  { return self.onFailure(err) }

      client.on('error', function(err) { self.onFailure(err) })
      client.query(self.sql, function(err, results, fields) {
          if (self.sql.match(/^\s*call/i)) {
              // Hack in a consumer function to eat the extra packet left in the client after proc calls
              client._enqueue( function() {}, function(err, data) {});
          }

          self.pool.release(client)
          err ? self.onFailure(err) : self.onSuccess(self.sql, results, fields)
      })
  })

  return this
}

Query.prototype.onSuccess = function(query, results, fields) {
  var result = this.callee
    , self   = this

  // add the inserted row id to the instance
  if (this.callee && (query.indexOf('INSERT ') == 0) && (results.hasOwnProperty('insertId')))
    this.callee[this.callee.definition.autoIncrementField] = results.insertId

  // transform results into real model instances
  // return the first real model instance if options.plain is set (e.g. Model.find)
  if (query.indexOf('SELECT') == 0 || self.options.buildResults) {
    result = results.map(function(result) { return self.callee.build(result, {isNewRecord: false}, self.options['fillPlan']) })

    if(this.options.plain)
      result = (result.length == 0) ? null : result[0]
  }

  if (this.options.logging)
    console.log('Finished (' + (Date.now() - this.startTime) + 'ms) : ' +
                this.sql.slice(0, 64));

  this.emit('success', result)
}

Query.prototype.onFailure = function(err) {
  if (this.options.logging) {
      console.log('Error: ' +this.sql.slice(0, 64))
      console.log(err);
  }

  this.emit('failure', err, this.callee)
}