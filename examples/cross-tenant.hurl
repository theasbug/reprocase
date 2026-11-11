# Manually authored baseline for the owned ReproCase fixture.
# Supply base, owner_token, researcher_token, and a NEW marker as Hurl variables.

GET {{base}}/me
Authorization: Bearer {{owner_token}}
HTTP 200
[Captures]
owner_id: jsonpath "$.id"
owner_tenant: jsonpath "$.tenant"
[Asserts]
jsonpath "$.role" == "member"

GET {{base}}/me
Authorization: Bearer {{researcher_token}}
HTTP 200
[Captures]
researcher_id: jsonpath "$.id"
researcher_tenant: jsonpath "$.tenant"
[Asserts]
jsonpath "$.role" == "member"
variable "owner_id" != "{{researcher_id}}"
variable "owner_tenant" != "{{researcher_tenant}}"

GET {{base}}/csrf
Authorization: Bearer {{owner_token}}
HTTP 200
[Captures]
csrf: jsonpath "$.csrf"

POST {{base}}/documents
Authorization: Bearer {{owner_token}}
Content-Type: application/json
x-csrf-token: {{csrf}}
{
  "title": "ReproCase controlled test document",
  "marker": "{{marker}}"
}
HTTP 201
[Captures]
document_id: jsonpath "$.id"
[Asserts]
jsonpath "$.ownerId" == "{{owner_id}}"
jsonpath "$.tenant" == "{{owner_tenant}}"
jsonpath "$.visibility" == "private"

GET {{base}}/documents/{{document_id}}
Authorization: Bearer {{owner_token}}
HTTP 200
[Asserts]
jsonpath "$.marker" == "{{marker}}"

GET {{base}}/documents/{{document_id}}
Authorization: Bearer {{researcher_token}}
HTTP 200
[Asserts]
jsonpath "$.marker" == "{{marker}}"
jsonpath "$.ownerId" == "{{owner_id}}"

DELETE {{base}}/documents/{{document_id}}
Authorization: Bearer {{owner_token}}
x-csrf-token: {{csrf}}
HTTP 200
[Asserts]
jsonpath "$.deleted" == true
