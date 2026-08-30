local stock_key = KEYS[1]
local product_id = ARGV[1]
local user_id = ARGV[2]

local current_stock = tonumber(redis.call('GET', stock_key))

if current_stock == nil then
    return redis.error_reply('PRODUCT_NOT_FOUND')
end

if current_stock <= 0 then
    return redis.error_reply('SOLD_OUT')
end

local new_stock = redis.call('DECRBY', stock_key, 1)

local order_data = cjson.encode({
    product_id = product_id,
    user_id = user_id,
    timestamp = redis.call('TIME')[1]
})
redis.call('LPUSH', 'queue:orders', order_data)

return {new_stock, 'OK'}