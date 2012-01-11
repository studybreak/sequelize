var Utils  = require("./utils")

var QueryGenerator = module.exports = {
  /*
    Returns a query for creating a table.
    Attributes should have the format: {attributeName: type, attr2: type2} --> {title: 'VARCHAR(255)'}
  */
  createTableQuery: function(tableName, attributes, options) {
    options = options || {}

    var query   = "CREATE TABLE IF NOT EXISTS <%= table %> (<%= attributes%>);"
      , primaryKeys = []
      , attrStr = Utils._.map(attributes, function(dataType, attr) {
          var dt = dataType
          if (Utils._.include(dt, 'PRIMARY KEY')) {
            primaryKeys.push(attr)
            return Utils.addTicks(attr) + " " + dt.replace(/PRIMARY KEY/, '')
          } else {
            return Utils.addTicks(attr) + " " + dt
          }
        }).join(", ")
      , values  = {table: Utils.addTicks(tableName), attributes: attrStr}
      , pkString = primaryKeys.map(function(pk) {return Utils.addTicks(pk)}).join(", ")

    if (pkString.length > 0) values.attributes += ", PRIMARY KEY (" + pkString + ")"

    return  Utils._.template(query)(values)
  },

  dropTableQuery: function(tableName, options) {
    options = options || {}

    var query = "DROP TABLE IF EXISTS <%= table %>;"

    return Utils._.template(query)({table: Utils.addTicks(tableName)})
  },

  /*
    Returns a query for selecting elements in the database <tableName>.
    Options:
      - attributes -> An array of attributes (e.g. ['name', 'birthday']). Default: *
      - where -> A hash with conditions (e.g. {name: 'foo'})
                 OR an ID as integer
                 OR a string with conditions (e.g. 'name="foo"').
                 If you use a string, you have to escape it on your own.
      - order -> e.g. 'id DESC'
      - group
      - limit -> The maximum count you want to get.
      - offset -> An offset value to start from. Only useable with limit!
      - fill -> An array of association names to fill
  */
  selectQuery: function(tableName, options, model) {
    options = options || {};
    procSelectOptions(tableName, options);

    var query = "SELECT <%= attributes %> FROM <%= table %>";

    if (options.join)
    	query += " " + options.join;

    if(options.where) {
      options.where = QueryGenerator.getWhereConditions(options.where, model);
      query += " WHERE <%= where %>";
    }
    if(options.order) query += " ORDER BY <%= order %>";
    if(options.group) {
      options.group = Utils.addTicks(options.group);
      query += " GROUP BY <%= group %>";
    }
    if(options.limit) {
      if(options.offset) query += " LIMIT <%= offset %>, <%= limit %>";
      else query += " LIMIT <%= limit %>";
    }

    query += ";";

    return Utils._.template(query)(options);
  },

  countQuery: function(tableName, options) {
    return QueryGenerator.selectQuery(tableName, options).replace("*", "count(*)")
  },

  /*
    Returns an insert into command. Parameters: table name + hash of attribute-value-pairs.
  */
  insertQuery: function(tableName, attrValueHash, ignore, updateKeys) {
    ignore = ignore || false
    var query = "INSERT "
    if (ignore) {
        query += "IGNORE "
    }
    query += "INTO <%= table %> (<%= attributes %>) VALUES (<%= values %>)"

    var replacements  = {
      table: Utils.addTicks(tableName),
      attributes: Utils._.keys(attrValueHash).map(function(attr){return Utils.addTicks(attr)}).join(","),
      values: Utils._.values(attrValueHash).map(function(value){
        return Utils.escape((value instanceof Date) ? Utils.toSqlDate(value) : value)
      }).join(",")
    }

    if (Utils._.isArray(updateKeys)) {
      query += " ON DUPLICATE KEY UPDATE "
      query += Utils._.map(updateKeys, function(key){
        var value = attrValueHash[key];
        return key + "=" + Utils.escape((value instanceof Date) ? Utils.toSqlDate(value) : value);
        }).join(',')
    }

    query += ";"
    return Utils._.template(query)(replacements)
  },

  /*
    Returns an update query.
    Parameters:
      - tableName -> Name of the table
      - values -> A hash with attribute-value-pairs
      - where -> A hash with conditions (e.g. {name: 'foo'})
                 OR an ID as integer
                 OR a string with conditions (e.g. 'name="foo"').
                 If you use a string, you have to escape it on your own.
  */
  updateQuery: function(tableName, values, where, model) {
    var query = "UPDATE <%= table %> SET <%= values %> WHERE <%= where %>"
    var replacements = {
      table: Utils.addTicks(tableName),
      values: Utils._.map(values, function(value, key){
        return Utils.addTicks(key) + "=" + Utils.escape((value instanceof Date) ? Utils.toSqlDate(value) : value)
      }).join(","),
      where: QueryGenerator.getWhereConditions(where, model)
    }

    return Utils._.template(query)(replacements)
  },

  /*
    Returns a deletion query.
    Parameters:
      - tableName -> Name of the table
      - where -> A hash with conditions (e.g. {name: 'foo'})
                 OR an ID as integer
                 OR a string with conditions (e.g. 'name="foo"').
                 If you use a string, you have to escape it on your own.
    Options:
      - limit -> Maximaum count of lines to delete
  */
  deleteQuery: function(tableName, where, options, model) {
    options = options || {}
    options.limit = options.limit || 1

    var query = "DELETE FROM <%= table %> WHERE <%= where %> LIMIT <%= limit %>"
    var replacements = {
      table: Utils.addTicks(tableName),
      where: QueryGenerator.getWhereConditions(where, model),
      limit: Utils.escape(options.limit)
    }

    return Utils._.template(query)(replacements)
  },

  /*
    Takes something and transforms it into values of a where condition.
  */
  getWhereConditions: function(smth, model) {
    var result = null

    if(Utils.isHash(smth))
      result = QueryGenerator.hashToWhereConditions(smth, model)
    else if(typeof smth == 'number')
      result = Utils.addTicks('id') + "=" + Utils.escape(smth)
    else if(typeof smth == "string")
      result = smth
    else if(Array.isArray(smth))
      result = Utils.format(smth)

    return result
  },

  /*
    Takes a hash and transforms it into a mysql where condition: {key: value, key2: value2} ==> key=value AND key2=value2
    The values are transformed by the relevant datatype.
  */
  hashToWhereConditions: function(hash, model) {
    return Utils._.map(hash, function(value, key) {
      var _value, _key, operator;

      // If the key already contains `, then assume it's pre-ticked to allow
      // more complex keys in the where clause, e.g., `Activity`.`categoryId`
      _key = (key.indexOf('`') === -1) ? Utils.addTicks(key) : key;
      if (Array.isArray(value)) {
          _value = "(" + Utils._.map(value, function(subvalue) {
              if (model && Utils._.include(model.attributes[key], 'VARCHAR')) {
                  subvalue = String(subvalue);
              }
              return Utils.escape(subvalue);
          }).join(',') + ")"
          operator = " IN "
      }
      else {
          _value = Utils.escape(value);
          operator = " = "
      }

      return (_value == 'NULL') ? _key + " IS NULL" : [_key, _value].join(operator)
    }).join(" AND ")
  }
}

var procSelectOptions = function(tableName, options) {
      if (!options.fillPlan) {
        options.table = Utils.addTicks(tableName);
        options.attributes = options.attributes && options.attributes.map(function(attr){return Utils.addTicks(attr);}).join(", ");
        options.attributes = options.attributes || '*';
        return;
      }

      // Construct table joins and attribute list recursively from fillPlan
      var table = [options.fillPlan.defn.tableName, 'AS', options.fillPlan.prefix];
      var attributes = [];

      procPlan(options.fillPlan, table, attributes);

      options.table = table.join(" ");
      options.attributes = attributes.join(", ");
}

var procPlan = function(plan, table, attributes) {
    for (var attr in plan.attributes)
        attributes.push([plan.prefix+'.'+Utils.addTicks(attr), 'AS', Utils.addTicks(plan.prefix+'+'+attr)].join(' '));
    Utils._.each(plan.children,
        function(child) {
            table.push(child.assoc.joinStatement(plan.prefix, child.prefix));
            procPlan(child, table, attributes);
        }
    );
}
