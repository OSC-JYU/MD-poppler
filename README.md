

curl http://localhost:8300/api/process -d "@test/pdf2text.json" --header "Content-Type: application/json"


curl -X POST -H "Content-Type: multipart/form-data" \
  -F "request=@test/pdf2text.json;type=application/json" \
  -F "content=@test/sample.pdf" \
  http://localhost:8300/process



  GREMLIN

g.V('#105:7')
  .as('f')
  .repeat(both().simplePath())
  .until(hasLabel('Project'))
  .in('IS_OWNER')
  .hasLabel('Person')
  .has('id', 'ari.hayrinen@jyu.fi')
  .select('f')
