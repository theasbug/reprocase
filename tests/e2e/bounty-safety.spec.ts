import{test,expect}from'@playwright/test';import{createServer as httpServer}from'node:http';import{createServer}from'../../apps/server/src/server.ts';
test('scope denial sends no traffic, partial scans are visible and Stop cancels a live request',async({page})=>{
 let calls=0,first!:()=>void;const started=new Promise<void>(r=>first=r);const target=httpServer(()=>{calls++;first();});await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(target.address() as any).port}`;
 const server=await createServer({memory:true,port:0});try{
  const program=server.service.saveProgram({name:'Owned UI test',inScope:[origin+'/v2/*'],maxRps:100});await page.goto(server.url);await page.getByTestId('open-recon').click();
  await page.getByRole('button',{name:/3\. Program/}).click();await page.getByLabel('Target URL / Host to Verify').fill(origin+'/admin');await page.getByRole('button',{name:'Verify Scope',exact:true}).click();await expect(page.locator('.validation-item')).toContainText('OUT-OF-SCOPE');
  await page.getByRole('button',{name:/1\. Recon/}).click();await page.getByLabel('Target Origin URL',{exact:true}).fill(origin);await page.getByRole('button',{name:'Run Security Audit Pack',exact:true}).click();await expect(page.getByText('Inconclusive:',{exact:false})).toBeVisible();expect(calls).toBe(0);
  server.service.saveProgram({id:program.id,inScope:[origin+'/']});await page.getByRole('button',{name:'Run Security Audit Pack',exact:true}).click();await started;await page.getByRole('button',{name:'Stop network scans',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(calls).toBe(1);
 }finally{await server.close();target.closeAllConnections();await new Promise<void>(r=>target.close(()=>r()));}
});
