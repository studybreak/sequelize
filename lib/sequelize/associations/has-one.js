var Utils     = require("./../utils")
  , DataTypes = require('./../data-types')

var HasOne = module.exports = function(srcModel, targetModel, options) {
  this.source = srcModel
  this.target = targetModel
  this.options = options
  this.isSelfAssociation = (this.source.tableName == this.target.tableName)

  if(this.isSelfAssociation && !this.options.foreignKey && !!this.options.as)
    this.options.foreignKey = Utils._.underscoredIf(Utils.singularize(this.options.as) + "Id", this.options.underscored)

    this.associationAccessor = this.options.as || Utils.singularize(this.target.tableName);

  this.accessors = {
    get: Utils._.camelize('get_' + this.associationAccessor),
    set: Utils._.camelize('set_' + this.associationAccessor)
  }
}

// the id is in the target table
HasOne.prototype.injectAttributes = function() {
  var newAttributes = {};
  
  this.identifier = this.options.foreignKey || Utils._.underscoredIf(Utils.singularize(this.source.tableName) + "Id", this.options.underscored);
  this.sourceIdentifier = this.source.identityAttribute;
  if (!this.target.attributes.hasOwnProperty(this.identifier)) {
      newAttributes[this.identifier] = { type: DataTypes.INTEGER };
      Utils._.extend(this.target.attributes, Utils.simplifyAttributes(newAttributes));
  }
  
  return this;
};

HasOne.prototype.injectGetter = function(obj) {
  var self = this;

  obj[this.accessors.get] = function() {
    var id    = obj[self.sourceIdentifier]
      , where = {};
    
    where[self.identifier] = id;
    return self.target.find({where: where});
  };
  
  return this;
};

HasOne.prototype.injectSetter = function(obj) {
  var self = this
  
  obj[this.accessors.set] = function(associatedObject) {
    var customEventEmitter = new Utils.CustomEventEmitter(function() {
      obj[self.accessors.get]().on('success', function(oldObj) {
        if(oldObj) {
          oldObj[self.identifier] = null
          oldObj.save()
        }

        associatedObject[self.identifier] = obj[self.sourceIdentifier];
        associatedObject.save()
        .on('success', function() { customEventEmitter.emit('success', associatedObject) })
        .on('failure', function(err) { customEventEmitter.emit('failure', err) })
      })
    })
    return customEventEmitter.run()
  }
  
  return this
}

HasOne.prototype.joinStatement = function(sourceAs, targetAs) {
    return ['JOIN', this.target.tableName, 'AS', targetAs, 'ON', targetAs+'.'+this.identifier, '=', sourceAs+'.'+this.sourceIdentifier].join(' ');
}