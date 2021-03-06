var Utils          = require("./utils")
  , Mixin          = require("./associations/mixin")
  , QueryGenerator = require("./query-generator")

var Model = module.exports = function(values, options, prefix) {
  var self = this

  this.definition = null // will be set in Model.build
  this.attributes = []
  this.options = options || {}

  // add all passed values to the model and store the attribute names in this.attributes
  Utils._.map(values, function(value, key) {
          if (prefix) {
              if (key.indexOf(prefix) != 0)
                  return;
              key = key.substring(prefix.length);
          }
          self.addAttribute(key, value);
      });

  // set id to null if not passed as value
  // a newly created model has no id
  var defaults = this.options.hasPrimaryKeys ? {} : { id: null }

  if(this.options.timestamps) {
    defaults[this.options.underscored ? 'created_at' : 'createdAt'] = new Date()
    defaults[this.options.underscored ? 'updated_at' : 'updatedAt'] = new Date()

    if(this.options.paranoid)
      defaults[this.options.underscored ? 'deleted_at' : 'deletedAt'] = null
  }

  Utils._.map(defaults, function(value, attr) {
    if(!self.hasOwnProperty(attr))
      self.addAttribute(attr, value)
  })
}
Utils.addEventEmitter(Model)
Utils._.map(Mixin.classMethods, function(fct, name) { Model[name] = fct })

Model.Events = {
  insert: 'InsertQuery',
  update: 'UpdateQuery',
  destroy: 'DestroyQuery'
}

Model.prototype.toJSON = function (attributes, externals) {
  var gatherAttributes = function (model) {
    attributes = (Utils._.isArray(attributes) ? attributes : model.attributes);
    externals = (Utils._.isArray(externals) ? externals : []);

    var data = {};
    Utils._.each(attributes, function (attribute) {
      if (attribute === 'createdAt' || attribute === 'updatedAt') return;
      data[attribute] = model[attribute];
    });
    Utils._.each(Utils._.keys(model), function (external) {
      if (model[external] && model[external].definition) {
        data[external] = model[external].toJSON();
      }
      else if (Utils._.include(externals, external)) {
        data[external] = JSON.stringify(model[external]);
      }
    });

    return data;
  };

  return gatherAttributes(this);
}

Model.prototype.toString = function (attributes) {
  return JSON.stringify(this.toJSON(attributes));
}

Model.prototype.addAttribute = function(attribute, value) {
  this[attribute] = value
  this.attributes.push(attribute)
}

Model.prototype.query = function() {
  var args = Utils._.map(arguments, function(arg, _) { return arg })
    , s    = this.definition.modelManager.sequelize

  args.push(this)
  return s.query.apply(s, args)
}

/**
 * Stub for a model validation routine. Should be overridden.
 */
Model.prototype.validate = function () {
  return true;
}

Model.prototype.save = function(flags) {
  var self = this
  var attr = this.options.underscored ? 'updated_at' : 'updatedAt'
  flags = flags || {}

  // If an "ON DUPLICATE UPDATE" is requestsed, make sure to set the timestamp
  if (flags.updateKeys) flags.updateKeys.push(attr)

  if(this.hasOwnProperty(attr))
    this[attr] = new Date()

  if (!self.validate()) {
    throw new Error('Save failed. Invalid model: ' + self.definition.name);
  }

  var eventEmitter = new Utils.CustomEventEmitter(function() {
    self.query(eventEmitter.sql).on('success', function(obj) {
      self.definition.emit('save', obj)

      var created = obj.isNewRecord;
      obj.isNewRecord = false

      eventEmitter.emit('success', obj)

      if (created)
        self.definition.emit('create', obj)
      else
        self.definition.emit('update', obj)
    })
    .on('failure', function(err) { eventEmitter.emit('failure', err) })
  })

  // Attach the sql to the event emitter so the tests can get at sql
  var identifier = this.options.hasPrimaryKeys ? this.primaryKeyValues : this.id
  eventEmitter.sql = this.isNewRecord
      ? QueryGenerator.insertQuery(this.definition.tableName, this.values, flags.ignore, flags.updateKeys)
      : QueryGenerator.updateQuery(this.definition.tableName, this.values, identifier, this)

  return eventEmitter.run()
}

Model.prototype.updateAttributes = function(updates) {
  var self = this

  var readOnlyAttributes = Utils._.keys(this.definition.primaryKeys)
  readOnlyAttributes.push('id')
  readOnlyAttributes.push('createdAt')
  readOnlyAttributes.push('updatedAt')
  readOnlyAttributes.push('deletedAt')

  Utils._.each(updates, function(value, attr) {
    var updateAllowed = (
      (readOnlyAttributes.indexOf(attr) == -1) &&
      (readOnlyAttributes.indexOf(Utils._.underscored(attr)) == -1) &&
      (self.attributes.indexOf(attr) > -1)
    )
    updateAllowed && (self[attr] = value)
  })
  return this.save()
}

Model.prototype.destroy = function() {
  var self = this

  var eventEmitter = new Utils.CustomEventEmitter(function() {
    var query

    if(self.options.timestamps && self.options.paranoid) {
      self[self.options.underscored ? 'deleted_at' : 'deletedAt'] = new Date()
      query = self.save()
    } else {
      var identifier = self.options.hasPrimaryKeys ? self.primaryKeyValues : self.id
      query = self.query(QueryGenerator.deleteQuery(self.definition.tableName, identifier, self))
    }

    query.on('success', function (obj) {
      eventEmitter.emit('success', obj)
      self.definition.emit('destroy', obj)
    })
    .on('failure', function(err) { eventEmitter.emit('failure', err) })
  })

  return eventEmitter.run()
}

Model.prototype.__defineGetter__("identifiers", function() {
  var primaryKeys = Utils._.keys(this.definition.primaryKeys)
    , result      = {}
    , self        = this

  if(!this.definition.hasPrimaryKeys)
    primaryKeys = ['id']

  primaryKeys.forEach(function(identifier) {
    result[identifier] = self[identifier]
  })

  return result
})

Model.prototype.__defineGetter__('isDeleted', function() {
  var result = this.options.timestamps && this.options.paranoid
  result = result && this[this.options.underscored ? 'deleted_at' : 'deletedAt'] != null

  return result
})

Model.prototype.__defineGetter__('values', function() {
  var result = {}
    , self   = this

    // Only return values for attributes that are in the model defn
    this.attributes.forEach(function(attr) {
        if (self.definition.attributes[attr]) result[attr] = self[attr];
    });

  return result
})

Model.prototype.__defineGetter__('primaryKeyValues', function() {
  var result = {}
    , self   = this

  Utils._.each(this.definition.primaryKeys, function(_, attr) {
    result[attr] = self[attr]
  })

  return result
})

Model.prototype.equals = function(other) {
  var result = true
    , self   = this

  Utils._.each(this.values, function(value, key) {
    result = result && (value == other[key])
  })

  return result
}

Model.prototype.equalsOneOf = function(others) {
  var result = false
    , self   = this

  others.forEach(function(other) { result = result || self.equals(other) })

  return result
}

/* Add the instance methods to Model */
Utils._.map(Mixin.instanceMethods, function(fct, name) { Model.prototype[name] = fct})
