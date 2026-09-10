const SPEC_URL = "https://developers.dealerkit.co.uk/spec.json";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function fetchJsonish(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "DealerKitPhase1OpenApiInspection/1.0" },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenAPI spec returned ${response.status}`);
    let parsed = JSON.parse(text);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== "object") throw new Error("OpenAPI spec did not decode to an object");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function schemaRef(value) {
  return typeof value?.$ref === "string" ? value.$ref : "";
}

function safeSchemaShape(schema, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== "object" || depth > 4) return null;
  const ref = schemaRef(schema);
  if (ref) return { ref };

  const result = {};
  if (schema.type) result.type = schema.type;
  if (schema.format) result.format = schema.format;
  if (schema.nullable === true) result.nullable = true;
  if (Array.isArray(schema.enum)) result.enum = schema.enum.slice(0, 50);
  if (schema.description) result.description = compact(schema.description).slice(0, 300);
  if (schema.items) result.items = safeSchemaShape(schema.items, depth + 1, seen);

  if (schema.properties && typeof schema.properties === "object") {
    result.required = Array.isArray(schema.required) ? schema.required : [];
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, safeSchemaShape(value, depth + 1, seen)]));
  }
  return result;
}

function parameterSummary(parameter) {
  return {
    name: parameter?.name || "",
    in: parameter?.in || "",
    required: Boolean(parameter?.required),
    description: compact(parameter?.description || "").slice(0, 200),
    schema: safeSchemaShape(parameter?.schema),
  };
}

function operationSummary(spec, path, method) {
  const operation = spec.paths?.[path]?.[method];
  if (!operation) return null;
  const parameters = [
    ...(Array.isArray(spec.paths?.[path]?.parameters) ? spec.paths[path].parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ].map(parameterSummary);

  const responses = Object.fromEntries(Object.entries(operation.responses || {}).map(([code, response]) => {
    const content = response?.content || {};
    const contentTypes = Object.keys(content);
    return [code, {
      description: compact(response?.description || "").slice(0, 200),
      contentTypes,
      schemas: contentTypes.map((type) => ({ type, schema: safeSchemaShape(content[type]?.schema) })),
    }];
  }));

  return {
    method: method.toUpperCase(),
    path,
    operationId: operation.operationId || "",
    summary: compact(operation.summary || "").slice(0, 200),
    parameters,
    security: operation.security || spec.security || [],
    responses,
  };
}

function resolveRef(spec, ref) {
  if (!ref?.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
}

function namedSchemaSummary(spec, name) {
  const schema = spec.components?.schemas?.[name];
  if (!schema) return null;
  const direct = safeSchemaShape(schema);
  const expandedProperties = {};
  for (const [key, value] of Object.entries(schema.properties || {})) {
    const ref = schemaRef(value) || schemaRef(value?.items);
    expandedProperties[key] = {
      shape: safeSchemaShape(value),
      referencedSchema: ref ? safeSchemaShape(resolveRef(spec, ref)) : null,
    };
  }
  return { name, direct, expandedProperties };
}

function findStockSchemaNames(spec) {
  return Object.keys(spec.components?.schemas || {}).filter((name) => /stock|vehicle|image|media|pagination|meta|price|vat|spec|option/i.test(name));
}

export async function inspectDealerKitOpenApi() {
  console.log("\n[DealerKit Phase 1] Safe OpenAPI stock-contract inventory starting.");
  console.log(JSON.stringify({
    preview: process.env.VERCEL_ENV === "preview",
    secretConfigured: Boolean(process.env.DEALERKIT_API_SECRET),
    dealerIdConfigured: Boolean(process.env.DEALERKIT_DEALER_ID),
    secretValueLogged: false,
    dealerIdValueLogged: false,
    dealerApiCalled: false,
  }, null, 2));

  const spec = await fetchJsonish(SPEC_URL);
  const securitySchemes = Object.entries(spec.components?.securitySchemes || {}).map(([name, value]) => ({
    name,
    type: value?.type || "",
    scheme: value?.scheme || "",
    bearerFormat: value?.bearerFormat || "",
    in: value?.in || "",
    headerName: value?.name || "",
  }));

  const stockSchemaNames = findStockSchemaNames(spec);
  const preferredSchemas = Array.from(new Set([
    "stock-listing",
    "stock-listing-item",
    "stock",
    "pagination-meta",
    "meta",
    ...stockSchemaNames,
  ])).filter((name) => spec.components?.schemas?.[name]).slice(0, 30);

  const summary = {
    openapi: spec.openapi || spec.swagger || "",
    title: spec.info?.title || "",
    version: spec.info?.version || "",
    servers: (spec.servers || []).map((server) => server?.url).filter(Boolean),
    securitySchemes,
    stockList: operationSummary(spec, "/stock", "get"),
    stockDetail: operationSummary(spec, "/stock/{id}", "get"),
    dealerList: operationSummary(spec, "/dealers", "get"),
    dealerDetail: operationSummary(spec, "/dealers/{id}", "get"),
    stockRelatedSchemaNames: stockSchemaNames,
    schemas: preferredSchemas.map((name) => namedSchemaSummary(spec, name)).filter(Boolean),
  };

  console.log("[DealerKit Phase 1] Safe OpenAPI inventory:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("[DealerKit Phase 1] Safe OpenAPI inventory complete. No authenticated DealerKit API request was made.\n");
}
