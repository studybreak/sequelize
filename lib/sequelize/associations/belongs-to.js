var Utils     = require("./../utils")
  , DataTypes = require('./../data-types')

var BelongsTo = module.exports = function(srcModel, targetModel, options) {
  this.source = srcModel
  this.target = targetModel
  this.options = options
  this.isSelfAssociation = (this.source.tableName == this.target.tableName)
  
  if(this.isSelfAssociation && !this.options.foreignKey && !!this.options.as)
    this.options.foreignKey = Utils._.underscoredIf(Utils.singularize(this.options.as) + "Id", this.source.options.underscored)
  
    this.associationAccessor = this.options.as || Utils.singularize(this.target.tableName);
}

// the id is in the source table
BelongsTo.prototype.injectAttributes = function() {
  var newAttributes  = {}
  
  this.identifier = this.options.foreignKey || Utils._.underscoredIf(Utils.singularize(this.target.tableName) + "Id", this.source.options.underscored);
  this.targetIdentifier = this.target.identityAttribute;
  if (!this.source.attributes.hasOwnProperty(this.identifier)){
      newAttributes[this.identifier] = { type: DataTypes.INTEGER };
      Utils._.extend(this.source.attributes, Utils.simplifyAttributes(newAttributes));
  }
  return this
}

BelongsTo.prototype.injectGetter = function(obj) {
  var self     = this
    , accessor = Utils._.camelize('get_' + this.associationAccessor);
  
  obj[accessor] = function() {
    var where = {};
    where[self.targetIdentifier] = obj[self.identifier];
    return self.target.find({where: where});
  };
  
  return this;
};

BelongsTo.prototype.injectSetter = function(obj) {
  var self     = this
    , accessor = Utils._.camelize('set_' + this.associationAccessor);
  
  obj[accessor] = function(associatedObject) {
    obj[self.identifier] = associatedObject ? associatedObject[self.targetIdentifier] : null;
    return obj.save();
  };
  
  return this;
};

BelongsTo.prototype.joinStatement = function(sourceAs, targetAs) {
    return ['LEFT OUTER JOIN', this.target.tableName, 'AS', targetAs, 'ON', targetAs+'.'+this.targetIdentifier, '=', sourceAs+'.'+this.identifier].join(' ');
};