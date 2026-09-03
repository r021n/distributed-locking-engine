local stock_key = KEYS[1]
local user_set_key = KEYS[2]
local product_id = ARGV[1]
local user_id = ARGV[2]

-- user checkout checking
if redis.call('SISMEMBER', user_set_key, user_id) == 1 then
    return redis.error_reply('USER_ALREADY_PURCHASED')
end

-- product stock checking
local current_stock = tonumber(redis.call('GET', stock_key))
if current_stock == nil then
    return redis.error_reply('PRODUCT_NOT_FOUND')
end

-- stock availability checking
if current_stock <= 0 then
    return redis.error_reply('SOLD_OUT')
end

-- atomic product stock decrement
local new_stock = redis.call('DECRBY', stock_key, 1)

-- register user to redis Set
redis.call('SADD', user_set_key, user_id)

-- add order to redislist
local order_data = cjson.encode({
    product_id = product_id,
    user_id = user_id,
    timestamp = redis.call('TIME')[1]
})
redis.call('LPUSH', 'queue:orders', order_data)

-- return remaining stok
return {new_stock, 'OK'}