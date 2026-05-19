--- Cross-language conformance: vectors in tests/conformance/*.json
--- describe RPC scenarios any implementation should satisfy. The
--- lua side runs every step whose target is nvim and asserts the
--- response matches the vector's `expect` clause.

local function load_vector(name)
  local here = debug.getinfo(1, "S").source:sub(2)
  local dir = here:match("(.*/)")
  local path = dir .. "../conformance/" .. name .. ".json"
  local f = assert(io.open(path, "r"))
  local body = f:read("*a")
  f:close()
  return vim.json.decode(body)
end

local function contains(haystack, needle)
  for _, v in ipairs(haystack) do
    if v == needle then
      return true
    end
  end
  return false
end

describe("conformance: handshake/v0.1.0", function()
  local vector = load_vector("handshake")

  it("loads with a single pi->nvim step", function()
    assert.is_string(vector.name)
    assert.are.equal("handshake/v0.1.0", vector.name)
    local nvim_steps = vim.tbl_filter(function(s)
      return s.to == "nvim"
    end, vector.steps)
    assert.are.equal(1, #nvim_steps)
  end)

  it("each pi->nvim step returns a response matching `expect`", function()
    for _, step in ipairs(vector.steps) do
      if step.to == "nvim" then
        assert.are.equal("nvim_exec_lua", step.call.method)
        local lua_src = step.call.args[1]
        local lua_args = step.call.args[2]
        local fn = assert(loadstring(lua_src))
        local result = fn(unpack(lua_args))

        assert.are.equal(step.expect.version, result.version)
        for _, cap in ipairs(step.expect.capabilities.contains) do
          assert.is_true(
            contains(result.capabilities, cap),
            "expected capability " .. cap .. " in nvim response"
          )
        end
      end
    end
  end)
end)
