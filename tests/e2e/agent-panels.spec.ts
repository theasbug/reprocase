import {test,expect} from '@playwright/test';
import {createServer} from '../../apps/server/src/server.ts';
test('beginner guide, slash navigation, agent mission and explicit MCP configuration',async({page})=>{
 const server=await createServer({memory:true,port:0});try{
  await page.goto(server.url);await page.locator('.assistant-toggle').click();
  await page.getByLabel('Message AI Assistant',{exact:true}).fill('/');await expect(page.locator('.slash-menu').getByRole('option').filter({hasText:'/mcp'})).toBeVisible();
  await page.getByRole('option').filter({hasText:'/help'}).click();const help=page.getByRole('dialog',{name:'User guide',exact:true});await expect(help).toBeVisible();await expect(help.getByRole('heading',{name:'1. What is ReproCase?',exact:true})).toBeVisible();
  await help.getByLabel('Search guide').fill('clipboard');await expect(help.locator('.guide-chapters section')).toHaveCount(1);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Tools & permissions',exact:true}).click();const env=page.getByRole('dialog',{name:'Tools, permissions & environment',exact:true});await expect(env.getByLabel('Agent prompt')).toHaveValue(/bug bounty/);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'MCP',exact:true}).click();const mcp=page.getByRole('dialog',{name:'MCP',exact:true});await mcp.getByLabel('Name',{exact:true}).fill('Local metadata only');await mcp.getByLabel('Transport',{exact:true}).selectOption('http');await mcp.getByLabel('URL',{exact:true}).fill('http://127.0.0.1:9/mcp');await mcp.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(mcp.locator('.mcp-server')).toContainText('disconnected');expect(server.service.mcp.tools()).toHaveLength(0);await mcp.getByRole('button',{name:'Remove',exact:true}).click();await expect(mcp.locator('.mcp-server')).toHaveCount(0);
 }finally{await server.close();}
});
